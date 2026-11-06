import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getExam, deleteCase, deleteSeries, addQuestion, deleteQuestion, updateCase, appendDicomToCase, createCaseDraft } from '../../api/exam';
import { normalizeThumbnailUrl } from '../../api/dicom';
import { useAdminStore } from '../../store/adminStore';

export default function ExamEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = useAdminStore((s) => s.token);
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showQuestionForm, setShowQuestionForm] = useState<number | null>(null); // caseId

  // Question form state
  const [qType, setQType] = useState('multiple_choice');
  const [qText, setQText] = useState('');
  const [qAnswer, setQAnswer] = useState('');
  const [qOptions, setQOptions] = useState<string[]>(['', '', '', '']); // array for MC options

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return; }
    fetchExam();
  }, [id]);

  const fetchExam = async () => {
    try {
      const res = await getExam(Number(id));
      setExam(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const caseId = (e.target as any)._targetCaseId;
    if (!files || files.length === 0 || !caseId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('dicom_files', files[i]);
      }
      await appendDicomToCase(Number(caseId), formData);
      await fetchExam();
    } catch (e: any) {
      alert(e.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const uploadDicomToCase = async (caseId: number, formData: FormData) => {
    return await appendDicomToCase(caseId, formData);
  };

  const handleDeleteCase = async (caseId: number) => {
    if (!confirm('确定删除该病例吗？相关题目也会被删除。')) return;
    try {
      await deleteCase(caseId);
      await fetchExam();
    } catch (e: any) {
      alert(e.response?.data?.detail || '删除失败');
    }
  };

  const handleDeleteSeries = async (seriesId: number) => {
    if (!confirm('确定删除该序列的影像数据吗？此操作不可撤销。')) return;
    try {
      await deleteSeries(seriesId);
      await fetchExam();
    } catch (e: any) {
      alert(e.response?.data?.detail || '删除失败');
    }
  };

  const handleAddQuestion = async (caseId: number) => {
    if (!qText.trim() || !qAnswer.trim()) return;
    try {
      // Build options JSON string from array
      let optionsStr: string | undefined;
      if (qType === 'multiple_choice') {
        const nonEmpty = qOptions.filter(o => o.trim());
        if (nonEmpty.length < 2) {
          alert('选择题至少需要2个选项');
          return;
        }
        const labeled = nonEmpty.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt.trim()}`);
        optionsStr = JSON.stringify(labeled);
      }
      await addQuestion(caseId, qType, qText, qAnswer, optionsStr || undefined);
      setShowQuestionForm(null);
      setQText('');
      setQOptions(['', '', '', '']);
      setQAnswer('');
      await fetchExam();
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail) || '添加失败';
      alert(msg);
    }
  };

  const handleDeleteQuestion = async (qId: number) => {
    if (!confirm('确定删除该题目吗？')) return;
    try {
      await deleteQuestion(qId);
      await fetchExam();
    } catch (e: any) {
      alert(e.response?.data?.detail || '删除失败');
    }
  };

  if (loading) return <div className="container" style={{ paddingTop: 40, textAlign: 'center' }}>加载中...</div>;
  if (!exam) return <div className="container" style={{ paddingTop: 40, textAlign: 'center' }}>考试不存在</div>;

  return (
    <div className="container" style={{ paddingTop: '24px', paddingBottom: '40px' }}>
      <Link to="/admin/dashboard" style={{ fontSize: '14px', marginBottom: '16px', display: 'inline-block' }}>
        ← 返回管理
      </Link>
      <h1 style={{ fontSize: '24px', marginBottom: '4px' }}>{exam.title}</h1>
      <p style={{ color: '#999', fontSize: '14px', marginBottom: '24px' }}>
        访问码: {exam.access_code} · {exam.case_count} 个病例 · {exam.question_count} 道题目
      </p>

      {/* Upload new case — creates an empty case card first */}
      <div style={styles.uploadCard}>
        <h3 style={{ marginBottom: '8px' }}>添加新病例</h3>
        <button
          onClick={async () => {
            try {
              await createCaseDraft(Number(id));
              await fetchExam();
            } catch (e: any) {
              alert(e.response?.data?.detail || '创建失败');
            }
          }}
          style={styles.uploadBtn}
        >
          + 新增空白病例
        </button>
        <span style={{ fontSize: '12px', color: '#999', marginLeft: '12px' }}>
          创建后可在病例卡片中上传DICOM影像、填写备注和题目
        </span>
      </div>

      {/* Cases list */}
      <div>
        {exam.cases?.map((c: any, idx: number) => (
          <div key={c.id} style={styles.caseCard}>
            <div style={styles.caseHeader}>
              <h3>病例 {idx + 1}</h3>
              <button onClick={() => handleDeleteCase(c.id)} style={styles.deleteBtn}>删除病例</button>
            </div>

            {/* Step 1: Notes/title */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '4px' }}>病例标题/备注</label>
              <input
                type="text"
                placeholder="输入病例标题或临床备注..."
                defaultValue={c.notes || ''}
                onBlur={async (e) => {
                  try { await updateCase(c.id, e.target.value); } catch {}
                  fetchExam();
                }}
                style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #d9d9d9', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Step 2: Questions */}
            <div style={{ marginBottom: '12px', background: '#fafafa', padding: '12px', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ fontSize: '13px' }}>题目 ({c.questions?.length || 0})</strong>
                <button
                  onClick={() => setShowQuestionForm(showQuestionForm === c.id ? null : c.id)}
                  style={styles.addBtn}
                >
                  + 添加题目
                </button>
              </div>

              {showQuestionForm === c.id && (
                <div style={styles.questionForm}>
                  <select value={qType} onChange={(e) => setQType(e.target.value)} style={styles.select}>
                    <option value="multiple_choice">选择题</option>
                    <option value="fill_blank">填空题</option>
                  </select>
                  <div style={{ width: '100%' }}>
                    <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>题目内容</label>
                    <input
                      placeholder="请输入题目文本"
                      value={qText}
                      onChange={(e) => setQText(e.target.value)}
                      style={{ ...styles.input, width: '100%' }}
                    />
                  </div>
                  {qType === 'multiple_choice' && (
                    <div style={{ width: '100%' }}>
                      <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        选项（点击 + 增加，点击 ✕ 删除）
                      </label>
                      {qOptions.map((opt, i) => (
                        <div key={i} style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px', width: '24px', textAlign: 'center', color: '#666' }}>
                            {String.fromCharCode(65 + i)}.
                          </span>
                          <input
                            placeholder={'选项 ' + String.fromCharCode(65 + i)}
                            value={opt}
                            onChange={(e) => {
                              const next = [...qOptions];
                              next[i] = e.target.value;
                              setQOptions(next);
                            }}
                            style={{ ...styles.input, flex: 1 }}
                          />
                          {qOptions.length > 2 && (
                            <button
                              onClick={() => setQOptions(qOptions.filter((_, j) => j !== i))}
                              style={{ ...styles.smallBtn, color: '#ff4d4f' }}
                            >✕</button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => setQOptions([...qOptions, ''])}
                        style={{ ...styles.smallBtn, color: '#1677ff', marginTop: '4px' }}
                      >+ 添加选项</button>
                    </div>
                  )}
                  <div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1, minWidth: '160px' }}>
                        <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>
                          正确答案（多个以中文分号「；」分隔）
                        </label>
                        <input
                          placeholder={qType === 'multiple_choice' ? '如 A，多个：A；B' : '单选：“肺癌”　　多选：“肺癌；肺腺癌”'}
                          value={qAnswer}
                          onChange={(e) => setQAnswer(e.target.value)}
                          style={{ ...styles.input, width: '100%' }}
                        />
                      </div>
                      <button onClick={() => handleAddQuestion(c.id)} style={{ ...styles.btn, flexShrink: 0 }}>确认添加</button>
                    </div>
                    <p style={{ fontSize: '12px', color: '#999', margin: '6px 0 0', lineHeight: 1.5 }}>
                      {qType === 'multiple_choice'
                        ? '如为多选题，请用中文分号间隔，如“A；B”，用户需要全部选中才得分'
                        : '如有多个正确答案，请用中文分号间隔，如“肺癌；肺腺癌”，用户填任意一个即可得分'}
                    </p>
                  </div>
                </div>
              )}

              {c.questions?.map((q: any) => (
                <div key={q.id} style={styles.questionItem}>
                  <div style={{ flex: 1 }}>
                    <span style={styles.qTypeBadge}>
                      {q.question_type === 'multiple_choice' ? '选择' : '填空'}
                    </span>
                    <span>{q.question_text}</span>
                    <span style={{ color: '#52c41a', fontSize: '12px', marginLeft: '8px' }}>
                      答案: {q.correct_answer}
                    </span>
                    {q.options && (
                      <div style={{ marginTop: '4px' }}>
                        {(Array.isArray(q.options) ? q.options : []).map((opt: string, i: number) => (
                          <span key={i} style={styles.optionTag}>{opt}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDeleteQuestion(q.id)} style={styles.deleteBtn}>删除</button>
                </div>
              ))}
            </div>

            {/* Step 3: DICOM upload */}
            <div style={{ background: '#f5f5f5', padding: '12px', borderRadius: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                影像上传 (DICOM)
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ ...styles.uploadBtn, fontSize: '13px', padding: '6px 14px' }}>
                  {uploading ? '处理中...' : '选择DICOM文件'}
                  <input
                    type="file"
                    accept=".zip,.tar.gz,.tgz,.dcm"
                    multiple
                    onChange={(e) => {
                      (e.target as any)._targetCaseId = c.id;
                      handleUpload(e);
                    }}
                    disabled={uploading}
                    style={{ display: 'none' }}
                  />
                </label>
                <span style={{ fontSize: '11px', color: '#999' }}>
                  支持ZIP压缩包或多个DCM文件，所有文件归属于此病例
                </span>
              </div>

              {(c.patient_sex || c.patient_age || c.study_description) && (
                <div style={styles.metaRow}>
                  {c.patient_sex && <span>性别: {c.patient_sex}</span>}
                  {c.patient_age && <span>年龄: {c.patient_age}</span>}
                  {c.study_description && <span>检查: {c.study_description}</span>}
                </div>
              )}

              {c.series && c.series.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <strong style={{ fontSize: '11px', color: '#666' }}>序列 ({c.series.length}):</strong>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {c.series.map((s: any) => (
                      <div key={s.id} style={{ position: 'relative' }}>
                        <div style={styles.seriesTag}>
                          <img
                            src={normalizeThumbnailUrl(s.thumbnail_url)}
                            alt={s.series_description}
                            style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '3px' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span style={{ fontSize: '10px', textAlign: 'center', lineHeight: 1.2 }}>
                            {s.series_description}
                            <br />
                            <span style={{ color: '#999' }}>{s.image_count} 帧</span>
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteSeries(s.id)}
                          title="删除此序列"
                          style={styles.seriesDeleteBtn}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  uploadCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  uploadBtn: {
    display: 'inline-block',
    padding: '10px 20px',
    background: '#1677ff',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    opacity: 1,
  },
  caseCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  caseHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  metaRow: {
    display: 'flex',
    gap: '16px',
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  seriesSection: {
    background: '#fafafa',
    padding: '10px 12px',
    borderRadius: '6px',
    marginBottom: '8px',
  },
  seriesTag: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '4px',
    border: '1px solid #e8e8e8',
    borderRadius: '6px',
    background: '#fff',
  },
  seriesDeleteBtn: {
    position: 'absolute' as const,
    top: '-6px',
    right: '-6px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: '1px solid #ff4d4f',
    background: '#fff',
    color: '#ff4d4f',
    fontSize: '12px',
    lineHeight: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  notes: {
    fontSize: '13px',
    color: '#666',
    background: '#fffbe6',
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid #ffe58f',
  },
  questionForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    background: '#fafafa',
    borderRadius: '6px',
    marginBottom: '12px',
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    outline: 'none',
    width: '150px',
  },
  input: {
    flex: 1,
    minWidth: '150px',
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  smallBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 8px',
    borderRadius: '4px',
  },
  btn: {
    padding: '8px 16px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },
  addBtn: {
    padding: '4px 12px',
    fontSize: '12px',
    background: '#fff',
    border: '1px dashed #1677ff',
    color: '#1677ff',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  deleteBtn: {
    padding: '4px 10px',
    fontSize: '12px',
    background: '#fff',
    border: '1px solid #ff4d4f',
    color: '#ff4d4f',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  questionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '8px 0',
    borderBottom: '1px solid #f0f0f0',
    gap: '12px',
  },
  qTypeBadge: {
    display: 'inline-block',
    fontSize: '11px',
    background: '#e6f7ff',
    color: '#1677ff',
    padding: '1px 6px',
    borderRadius: '3px',
    marginRight: '8px',
  },
  optionTag: {
    display: 'inline-block',
    fontSize: '11px',
    background: '#f0f0f0',
    padding: '2px 8px',
    borderRadius: '3px',
    marginRight: '6px',
    marginBottom: '4px',
  },
};
