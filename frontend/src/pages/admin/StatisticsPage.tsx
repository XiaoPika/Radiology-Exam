import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { getOverview, getPerQuestion, getPerUser, getTimeDistribution, getCaseAnalysis } from '../../api/statistics';
import { getExam, manageShareToken } from '../../api/exam';
import { useAdminStore } from '../../store/adminStore';

const ErrorDistribution = lazy(() => import('../../components/Charts/ErrorDistribution'));
const ScoreRanking = lazy(() => import('../../components/Charts/ScoreRanking'));
const TimeAnalysis = lazy(() => import('../../components/Charts/TimeAnalysis'));

// =============================================================
// Helpers
// =============================================================

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function scoreColor(pct: number) {
  if (pct >= 90) return '#52c41a';
  if (pct >= 80) return '#73d13d';
  if (pct >= 60) return '#faad14';
  return '#ff4d4f';
}

function scoreBg(pct: number) {
  if (pct >= 90) return '#f6ffed';
  if (pct >= 80) return '#fcffe6';
  if (pct >= 60) return '#fffbe6';
  return '#fff2f0';
}

const accColor = scoreColor;
const accBg = scoreBg;

function ChartFallback() {
  return <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>图表加载中...</p>;
}

// =============================================================
// Mini inline chart components
// =============================================================

function SparkBar({ value, max, color, height }: { value: number; max: number; color: string; height?: number }) {
  const h = height || 6;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ width: '100%', background: '#f0f0f0', borderRadius: h / 2, overflow: 'hidden', height: h }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: h / 2, transition: 'width 0.4s' }} />
    </div>
  );
}

// =============================================================
// Main Component
// =============================================================

export default function StatisticsPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get('share_token');
  const token = useAdminStore((s) => s.token);
  const [exam, setExam] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [perQuestion, setPerQuestion] = useState<any[]>([]);
  const [perUser, setPerUser] = useState<any[]>([]);
  const [timeDist, setTimeDist] = useState<any[]>([]);
  const [caseAnalysis, setCaseAnalysis] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'questions' | 'cases'>('overview');
  const [activeCaseIdx, setActiveCaseIdx] = useState<number | null>(null);
  const [shareMsg, setShareMsg] = useState('');

  const fetchData = () => {
    if (!id) return;
    const examId = Number(id);
    // When accessed via share_token, skip the admin exam endpoint (requires JWT)
    // and just pull from statistics endpoints that accept share_token
    const examPromise = shareToken
      ? Promise.resolve({ data: { title: '统计报告', access_code: '', case_count: 0, question_count: 0 } })
      : getExam(examId);
    Promise.all([
      examPromise,
      getOverview(examId, shareToken || undefined),
      getPerQuestion(examId, shareToken || undefined),
      getPerUser(examId, shareToken || undefined),
      getTimeDistribution(examId, shareToken || undefined),
      getCaseAnalysis(examId, shareToken || undefined),
    ])
      .then(([examRes, ovRes, pqRes, puRes, tdRes, caRes]) => {
        setExam(examRes.data);
        setOverview(ovRes.data);
        setPerQuestion(pqRes.data.questions || []);
        setPerUser(puRes.data.users || []);
        setTimeDist(tdRes.data.distribution || []);
        setCaseAnalysis(caRes.data.cases || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleInvalidate = async (sessionId: number) => {
    if (!confirm('确定作废此答卷吗？用户将可重新答题。')) return;
    try {
      await fetch(`/api/admin/statistics/invalidate/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (e: any) { alert('操作失败'); }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    try {
      const params = new URLSearchParams();
      params.append('name', editingUser.user_name || '');
      params.append('department', editingUser.department || '');
      params.append('employee_id', editingUser.employee_id || '');
      await fetch(`/api/admin/statistics/edit-user/${editingUser.user_id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      setEditingUser(null);
      fetchData();
    } catch (e: any) { alert('编辑失败'); }
  };

  if (loading) return <div className="container" style={{ paddingTop: 40, textAlign: 'center' }}>加载中...</div>;
  if (!exam) return <div className="container" style={{ paddingTop: 40 }}>考试不存在</div>;

  const maxScoreDist = overview ? Math.max(overview.score_distribution.excellent, overview.score_distribution.good, overview.score_distribution.pass, overview.score_distribution.fail, 1) : 1;

  // Filter questions by case
  const filteredQuestions = activeCaseIdx !== null ? perQuestion.filter(q => q.case_sort_order === activeCaseIdx || q.case_id === activeCaseIdx) : perQuestion;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          {!shareToken && <Link to="/admin/dashboard" style={s.backLink}>← 返回管理</Link>}
          {shareToken && <p style={{ fontSize: 12, color: '#888', margin: '0 0 4px' }}>只读分享视图</p>}
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '4px 0', color: '#1a1a1a' }}>考试分析: {exam.title}</h1>
          <p style={{ color: '#888', fontSize: 13, margin: 0 }}>
            访问码 <b>{exam.access_code}</b> · {exam.case_count} 病例 · {exam.question_count} 题
            {overview && <span> · {overview.total_participants} 人参与</span>}
          </p>
        </div>
        {!shareToken && token && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {exam.share_token ? (
              <>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/admin/exams/${id}/statistics?share_token=${exam.share_token}`;
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(url).then(() => { setShareMsg('分享链接已复制！'); setTimeout(() => setShareMsg(''), 2500); });
                    } else {
                      prompt('分享链接 (Ctrl+C复制):', url);
                    }
                  }}
                  style={{ ...s.shareBtn, background: '#f6ffed', borderColor: '#52c41a', color: '#52c41a' }}
                >
                  📋 复制分享链接
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('撤销分享链接后，持有旧链接的人将无法访问，确定？')) return;
                    try {
                      const res = await manageShareToken(Number(id), 'revoke');
                      setExam((e: any) => ({ ...e, share_token: null }));
                      setShareMsg('分享链接已撤销');
                      setTimeout(() => setShareMsg(''), 2000);
                    } catch { alert('操作失败'); }
                  }}
                  style={{ ...s.shareBtn, color: '#ff4d4f', borderColor: '#ffccc7' }}
                >
                  🔒 撤销分享
                </button>
              </>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await manageShareToken(Number(id), 'generate');
                    setExam((e: any) => ({ ...e, share_token: res.data.share_token }));
                    setShareMsg('分享链接已生成，点击「复制分享链接」分发');
                    setTimeout(() => setShareMsg(''), 3000);
                  } catch { alert('操作失败'); }
                }}
                style={s.shareBtn}
              >
                🔗 生成分享链接
              </button>
            )}
            {shareMsg && <span style={{ fontSize: 12, color: '#52c41a' }}>{shareMsg}</span>}
          </div>
        )}
      </div>

      {/* ===== TAB NAVIGATION ===== */}
      <div style={s.tabBar}>
        {[
          { key: 'overview' as const, label: '概览仪表盘', icon: '📊' },
          { key: 'users' as const, label: '考生排名', icon: '👥' },
          { key: 'questions' as const, label: '题目分析', icon: '📝' },
          { key: 'cases' as const, label: '病例难度', icon: '🏥' },
        ].map(t => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSelectedUser(null); }}
            style={{ ...s.tab, ...(activeTab === t.key ? s.tabActive : {}) }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ===== TAB: OVERVIEW DASHBOARD ===== */}
      {activeTab === 'overview' && overview && (
        <div>
          {/* Key metrics */}
          <div style={s.kpiGrid}>
            <KPICard label="参与人数" value={overview.total_participants} suffix="人" color="#1677ff" />
            <KPICard label="平均分" value={overview.avg_score} suffix="分" color="#722ed1" />
            <KPICard label="最高分" value={overview.max_score} suffix="分" color="#52c41a" />
            <KPICard label="最低分" value={overview.min_score} suffix="分" color="#ff4d4f" />
            <KPICard label="标准差" value={overview.stddev_score} suffix="" color="#fa8c16" />
            <KPICard label="及格率" value={overview.pass_rate} suffix="%" color="#13c2c2" />
            <KPICard label="平均用时" value={overview.avg_duration_minutes} suffix="分钟" color="#2f54eb" />
            <KPICard label="总题数" value={overview.total_questions} suffix="题" color="#595959" />
          </div>

          {/* Score distribution + Time distribution side by side */}
          <div style={s.twoCol}>
            {/* Score distribution bars */}
            <div style={s.card}>
              <h3 style={s.cardTitle}>📈 成绩分布</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 180, paddingTop: 16 }}>
                {[
                  { label: '优秀\n≥90%', count: overview.score_distribution.excellent, color: '#52c41a' },
                  { label: '良好\n80-89%', count: overview.score_distribution.good, color: '#73d13d' },
                  { label: '及格\n60-79%', count: overview.score_distribution.pass, color: '#faad14' },
                  { label: '不及格\n<60%', count: overview.score_distribution.fail, color: '#ff4d4f' },
                ].map(b => {
                  const h = maxScoreDist > 0 ? (b.count / maxScoreDist) * 140 : 0;
                  return (
                    <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: b.color }}>{b.count}</span>
                      <div style={{ width: '100%', maxWidth: 80, height: Math.max(h, 4), background: b.color, borderRadius: '6px 6px 0 0', transition: 'height 0.5s', opacity: 0.85 }} />
                      <span style={{ fontSize: 10, color: '#999', textAlign: 'center', marginTop: 4, whiteSpace: 'pre-line' }}>{b.label}</span>
                    </div>
                  );
                })}
              </div>
              {overview.total_participants > 0 && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 12, color: '#666' }}>
                  及格率 <b style={{ color: overview.pass_rate >= 60 ? '#52c41a' : '#ff4d4f' }}>{overview.pass_rate}%</b>（{overview.pass_count}/{overview.total_participants} 人及格）
                </div>
              )}
            </div>

            {/* Time distribution */}
            <div style={s.card}>
              <h3 style={s.cardTitle}>⏱️ 答题时长分布</h3>
              <Suspense fallback={<ChartFallback />}>
                <TimeAnalysis data={timeDist} />
              </Suspense>
            </div>
          </div>

          {/* User ranking preview */}
          <div style={{ ...s.card, marginTop: 16 }}>
            <h3 style={s.cardTitle}>🏆 成绩排名 TOP10</h3>
            <Suspense fallback={<ChartFallback />}>
              <ScoreRanking data={perUser} />
            </Suspense>
          </div>
        </div>
      )}

      {/* ===== TAB: USER RANKING ===== */}
      {activeTab === 'users' && (
        <div>
          {selectedUser ? (
            /* === Single user deep-dive === */
            <div style={s.card}>
              <button onClick={() => setSelectedUser(null)} style={{ ...s.smallBtn, marginBottom: 16 }}>← 返回排名总览</button>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 22 }}>{selectedUser.user_name}</h2>
                  <p style={{ margin: '4px 0', color: '#888', fontSize: 13 }}>
                    {selectedUser.department || '无部门'} · {selectedUser.employee_id || '无工号'} · 排名 #{selectedUser.rank}
                  </p>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'center', padding: '12px 24px', background: accBg(selectedUser.percentage), borderRadius: 12 }}>
                  <div style={{ fontSize: 36, fontWeight: 800, color: accColor(selectedUser.percentage) }}>{selectedUser.percentage}%</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{selectedUser.score}/{selectedUser.total} · {formatDuration(selectedUser.duration_seconds)}</div>
                </div>
              </div>

              {/* Case breakdown mini bars */}
              <h4 style={{ fontSize: 14, margin: '12px 0 8px', color: '#333' }}>病例维度掌握情况</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                {selectedUser.case_breakdown?.map((cb: any, i: number) => (
                  <div key={i} style={{ flex: '1 1 100px', minWidth: 100, padding: 12, background: '#fafafa', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>病例 {cb.case_id}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor(cb.pct) }}>{cb.pct}%</div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>{cb.correct}/{cb.total} 正确</div>
                    <SparkBar value={cb.pct} max={100} color={scoreColor(cb.pct)} height={4} />
                  </div>
                ))}
              </div>

              {/* Answer detail grid */}
              <h4 style={{ fontSize: 14, margin: '12px 0 8px', color: '#333' }}>逐题答题详情</h4>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>病例</th><th style={s.th}>题目</th><th style={s.th}>用户答案</th><th style={s.th}>正确答案</th><th style={s.th}>结果</th>
                </tr></thead>
                <tbody>
                  {selectedUser.records?.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={s.td}>病例{r.case_sort_order}</td>
                      <td style={s.td}>{i + 1}</td>
                      <td style={s.td}>{r.user_answer || <span style={{ color: '#ccc' }}>未作答</span>}</td>
                      <td style={s.td}><span style={{ color: '#52c41a' }}>{r.correct_answer}</span></td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, background: r.is_correct ? '#f6ffed' : r.is_correct === false ? '#fff2f0' : '#fafafa', color: r.is_correct ? '#52c41a' : r.is_correct === false ? '#ff4d4f' : '#ccc' }}>
                          {r.is_correct ? '✓ 正确' : r.is_correct === false ? '✗ 错误' : '— 跳过'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* === Full ranking table === */
            <div style={s.card}>
              <h3 style={s.cardTitle}>👥 考生综合排名（{perUser.length}人）</h3>
              {/* User-level summary stats */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {perUser.map((u: any) => (
                  <div key={u.user_id} onClick={() => setSelectedUser(u)}
                    style={{ cursor: 'pointer', flex: '1 1 280px', minWidth: 260, padding: 16, borderRadius: 10, border: '1px solid #f0f0f0', background: '#fff', transition: 'box-shadow 0.2s' }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 11, color: '#fff', background: u.rank <= 3 ? '#1677ff' : '#999', borderRadius: 8, padding: '1px 8px', marginRight: 8, fontWeight: 600 }}>#{u.rank}</span>
                        <b style={{ fontSize: 15 }}>{u.user_name}</b>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(u.percentage) }}>{u.percentage}%</div>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: '#888' }}>
                      <span>{u.department || '—'}</span>
                      <span>用时 {formatDuration(u.duration_seconds)}</span>
                      <span>{u.score}/{u.total} 题</span>
                    </div>
                    <SparkBar value={u.percentage} max={100} color={scoreColor(u.percentage)} height={5} />
                  </div>
                ))}
                {perUser.length === 0 && <p style={{ textAlign: 'center', color: '#999', padding: 40, width: '100%' }}>暂无答卷</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: QUESTION ANALYSIS ===== */}
      {activeTab === 'questions' && (
        <div>
          {/* Case filter chips */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setActiveCaseIdx(null)} style={{ ...s.filterChip, ...(activeCaseIdx === null ? s.filterChipActive : {}) }}>全部病例</button>
            {caseAnalysis.map(ca => (
              <button key={ca.case_id} onClick={() => setActiveCaseIdx(ca.case_id)}
                style={{ ...s.filterChip, ...(activeCaseIdx === ca.case_id ? s.filterChipActive : {}) }}>
                病例 {ca.sort_order}: {(ca.study_description || ca.notes || '—').slice(0, 12)}
              </button>
            ))}
          </div>

          {/* Error distribution chart */}
          <div style={s.card}>
            <Suspense fallback={<ChartFallback />}>
              <ErrorDistribution data={filteredQuestions} />
            </Suspense>
          </div>

          {/* Question detail cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            {filteredQuestions.map((q: any) => (
              <div key={q.question_id} style={{ flex: '1 1 340px', minWidth: 300, background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ ...s.badge, background: q.question_type === 'multiple_choice' ? '#e6f7ff' : '#f9f0ff', color: q.question_type === 'multiple_choice' ? '#1677ff' : '#722ed1', marginRight: 8 }}>
                      {q.question_type === 'multiple_choice' ? '选择' : '填空'}
                    </span>
                    <span style={{ ...s.badge, background: q.difficulty === '简单' ? '#f6ffed' : q.difficulty === '中等' ? '#fffbe6' : '#fff2f0', color: q.difficulty === '简单' ? '#52c41a' : q.difficulty === '中等' ? '#faad14' : '#ff4d4f' }}>
                      {q.difficulty}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#aaa' }}>病例{q.case_sort_order}</span>
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 8px', color: '#333' }}>{q.question_text}</p>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#666', marginBottom: 8 }}>
                  <span>✓ {q.correct_count}</span><span>✗ {q.incorrect_count}</span><span>— {q.skip_count}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#999', minWidth: 50 }}>正确率</span>
                  <SparkBar value={q.accuracy} max={100} color={q.accuracy >= 60 ? '#52c41a' : '#ff4d4f'} height={6} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: q.accuracy >= 60 ? '#52c41a' : '#ff4d4f', minWidth: 40, textAlign: 'right' }}>{q.accuracy}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#999', minWidth: 50 }}>错误率</span>
                  <SparkBar value={q.error_rate} max={100} color="#ff4d4f" height={6} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#ff4d4f', minWidth: 40, textAlign: 'right' }}>{q.error_rate}%</span>
                </div>
                {/* Wrong answer distribution */}
                {q.wrong_answer_distribution && q.wrong_answer_distribution.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11 }}>
                    <span style={{ color: '#999' }}>常见错误答案:</span>
                    {q.wrong_answer_distribution.map((wa: any, i: number) => (
                      <span key={i} style={{ marginLeft: 6, padding: '1px 6px', background: '#fff2f0', borderRadius: 4, color: '#ff4d4f' }}>
                        "{wa.answer}" ×{wa.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filteredQuestions.length === 0 && (
              <p style={{ textAlign: 'center', color: '#999', padding: 40, width: '100%' }}>暂无题目数据</p>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: CASE DIFFICULTY ===== */}
      {activeTab === 'cases' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {caseAnalysis.map((ca: any) => (
              <div key={ca.case_id} style={{ flex: '1 1 300px', minWidth: 280, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#333' }}>病例 {ca.sort_order}</h3>
                    <p style={{ fontSize: 12, color: '#999', margin: 0 }}>{(ca.study_description || ca.notes || '—').slice(0, 30)}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 14px', background: accBg(ca.accuracy), borderRadius: 10 }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: accColor(ca.accuracy) }}>{ca.accuracy}%</div>
                    <div style={{ fontSize: 10, color: '#999' }}>正确率</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {ca.question_count} 题 · 总回答 {ca.total_responses} 次
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#52c41a' }}>✓ {ca.correct}</span>
                  <span style={{ fontSize: 12, color: '#ff4d4f' }}>✗ {ca.incorrect}</span>
                  <span style={{ fontSize: 12, color: '#ccc' }}>— {ca.skipped}</span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                  <div style={{ flex: ca.correct / Math.max(ca.total_responses, 1), height: 6, background: '#52c41a', borderRadius: 3 }} />
                  <div style={{ flex: ca.incorrect / Math.max(ca.total_responses, 1), height: 6, background: '#ff4d4f', borderRadius: 3 }} />
                  <div style={{ flex: ca.skipped / Math.max(ca.total_responses, 1), height: 6, background: '#d9d9d9', borderRadius: 3 }} />
                </div>
              </div>
            ))}
            {caseAnalysis.length === 0 && <p style={{ textAlign: 'center', color: '#999', padding: 40, width: '100%' }}>暂无病例统计</p>}
          </div>
        </div>
      )}

      {/* ===== LEGACY TABLE (keep at bottom for detailed data) ===== */}
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, marginTop: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <h3 style={{ marginBottom: 16 }}>📋 完整答题记录</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f0f0f0', textAlign: 'left' }}>
                <th style={s.th}>#</th><th style={s.th}>姓名</th><th style={s.th}>部门</th><th style={s.th}>工号</th>
                <th style={s.th}>得分</th><th style={s.th}>用时</th><th style={s.th}>答题详情</th>
                <th style={s.th}>提交时间</th><th style={s.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {[...perUser]
                // Sort by submission time descending (latest first); always render
                // for this legacy table without disturbing the ranking-ordered
                // `perUser` used by the "考生排名" tab above.
                .sort((a, b) => {
                  const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
                  const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
                  return tb - ta;
                })
                .map((user: any) => (
                <tr key={user.user_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={s.td}><span style={{ fontWeight: 700, color: user.rank <= 3 ? '#1677ff' : '#999' }}>#{user.rank}</span></td>
                  <td style={s.td}><b style={{ cursor: 'pointer' }} onClick={() => { setSelectedUser(user); setActiveTab('users'); }}>{user.user_name}</b></td>
                  <td style={s.td}>{user.department || '--'}</td>
                  <td style={s.td}>{user.employee_id || '--'}</td>
                  <td style={s.td}>
                    <span style={{ color: scoreColor(user.percentage), fontWeight: 600 }}>{user.percentage}%</span>
                    <span style={{ color: '#999', fontSize: 11, marginLeft: 4 }}>({user.score}/{user.total})</span>
                  </td>
                  <td style={s.td}>{formatDuration(user.duration_seconds)}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {user.records?.map((rec: any, idx: number) => (
                        <div key={idx} title={`题${rec.question_id}: ${rec.user_answer || '(未作答)'} → 正确:${rec.correct_answer}`}
                          style={{
                            padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                            color: rec.is_correct ? '#5a7d5a' : rec.is_correct === false ? '#8b5e5e' : '#aaa',
                            background: rec.is_correct ? '#eaf0e5' : rec.is_correct === false ? '#f2e7e4' : '#f5f5f5',
                            border: `1px solid ${rec.is_correct ? '#b5c4b1' : rec.is_correct === false ? '#d2b5ad' : '#e8e8e8'}`,
                            cursor: 'default',
                          }}>
                          {rec.user_answer || '--'}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td style={s.td}>{user.submitted_at ? new Date(user.submitted_at).toLocaleString('zh-CN') : '--'}</td>
                  <td style={s.td}>
                    {!shareToken && (
                      <>
                        <button onClick={() => setEditingUser({ ...user, employee_id: user.employee_id || '' })} style={s.actionBtn}>编辑</button>
                        <button onClick={() => handleInvalidate(user.session_id)} style={{ ...s.actionBtn, color: '#ff4d4f' }}>作废</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {perUser.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无答卷</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== EDIT USER MODAL ===== */}
      {editingUser && (
        <div style={s.modalOverlay} onClick={() => setEditingUser(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h3>编辑用户信息</h3>
            <label>姓名</label>
            <input value={editingUser.user_name || ''} onChange={e => setEditingUser({ ...editingUser, user_name: e.target.value })} style={s.input} />
            <label>部门</label>
            <input value={editingUser.department || ''} onChange={e => setEditingUser({ ...editingUser, department: e.target.value })} style={s.input} />
            <label>工号</label>
            <input value={editingUser.employee_id || ''} onChange={e => setEditingUser({ ...editingUser, employee_id: e.target.value })} style={s.input} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingUser(null)} style={{ ...s.actionBtn, padding: '8px 16px' }}>取消</button>
              <button onClick={handleEditUser} style={{ padding: '8px 16px', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
// Sub-components
// =============================================================

function KPICard({ label, value, suffix, color }: { label: string; value: number | string; suffix: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', minWidth: 120 }}>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1.1 }}>{value}<span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>{suffix}</span></div>
      <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// =============================================================
// Styles
// =============================================================

const s: Record<string, React.CSSProperties> = {
  backLink: { fontSize: 14, marginBottom: 8, display: 'inline-block', color: '#1677ff', textDecoration: 'none' },
  tabBar: { display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' },
  tab: { padding: '10px 20px', fontSize: 14, background: '#f5f5f5', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 500, color: '#666', transition: 'all 0.2s' },
  tabActive: { background: '#1677ff', color: '#fff', boxShadow: '0 2px 8px rgba(22,119,255,0.3)' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: '#333' },
  filterChip: { padding: '6px 14px', fontSize: 12, border: '1px solid #d9d9d9', borderRadius: 20, background: '#fff', cursor: 'pointer', color: '#666' },
  filterChipActive: { border: '1px solid #1677ff', background: '#e6f7ff', color: '#1677ff', fontWeight: 500 },
  badge: { display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 500 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { padding: '8px', borderBottom: '2px solid #f0f0f0', textAlign: 'left' as const, fontWeight: 600, color: '#666', fontSize: 12, whiteSpace: 'nowrap' as const },
  td: { padding: '8px', color: '#333', fontSize: 13 },
  actionBtn: { padding: '4px 10px', fontSize: 12, background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4, cursor: 'pointer', marginRight: 6 },
  smallBtn: { padding: '6px 14px', fontSize: 13, background: '#f0f0f0', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#333' },
  shareBtn: { padding: '7px 14px', fontSize: 13, background: '#fff', border: '1px solid #d9d9d9', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  modalOverlay: { position: 'fixed' as const, top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', padding: 24, borderRadius: 12, width: '90%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  input: { width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d9d9d9', borderRadius: 6, outline: 'none', marginTop: 4, marginBottom: 12, boxSizing: 'border-box' as const },
};
