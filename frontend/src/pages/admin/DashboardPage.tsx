import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listExams, createExam, deleteExam, togglePublish } from '../../api/exam';
import { useAdminStore } from '../../store/adminStore';
import { QRCode } from 'antd';

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const token = useAdminStore((s) => s.token);
  const isSuperadmin = useAdminStore((s) => s.isSuperadmin);
  const displayName = useAdminStore((s) => s.displayName);
  const logout = useAdminStore((s) => s.logout);
  const [exams, setExams] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrTitle, setQrTitle] = useState('');

  const fetchExams = async () => {
    try {
      const res = await listExams();
      setExams(res.data.exams);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/admin/login');
      return;
    }
    fetchExams();
  }, [token]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await createExam(title, desc || undefined);
      setTitle('');
      setDesc('');
      await fetchExams();
    } catch (e: any) {
      alert(e.response?.data?.detail || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该考试吗？')) return;
    try {
      await deleteExam(id);
      await fetchExams();
    } catch (e: any) {
      alert(e.response?.data?.detail || '删除失败');
    }
  };

  const handleTogglePublish = async (id: number) => {
    try {
      await togglePublish(id);
      await fetchExams();
    } catch (e: any) {
      alert(e.response?.data?.detail || '操作失败');
    }
  };

  // 答题链接（支持基于当前 origin 动态解析，也可由 VITE_PUBLIC_URL 环境变量自定义）
  const getExamUrl = (code: string) => {
    const customBase = (import.meta as any).env?.VITE_PUBLIC_URL;
    const origin = customBase || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${origin.replace(/\/$/, '')}/exam/${code}`;
  };

  const copyLink = (url: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        alert('链接已复制到剪贴板');
      }).catch(() => {
        fallbackCopy(url);
      });
    } else {
      fallbackCopy(url);
    }
  };

  const fallbackCopy = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      alert('链接已复制到剪贴板');
    } catch (e) {
      prompt('请手动复制链接 (Ctrl+C):', text);
    }
    document.body.removeChild(textarea);
  };

  const showQrCode = (code: string, examTitle: string) => {
    setQrUrl(getExamUrl(code));
    setQrTitle(examTitle);
  };

  return (
    <div className="container" style={{ paddingTop: '24px', paddingBottom: '40px' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ fontSize: '24px', margin: 0 }}>考试管理</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>
            {displayName}
            {isSuperadmin && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#e6f4ff', color: '#1677ff', padding: '1px 6px', borderRadius: '4px', border: '1px solid #91caff' }}>超管</span>}
          </span>
          {isSuperadmin && (
            <button onClick={() => navigate('/admin/users')} style={{ ...styles.actionBtn, fontSize: '13px' }}>
              用户管理
            </button>
          )}
          <button onClick={() => { logout(); navigate('/admin/login'); }} style={{ ...styles.actionBtn, color: '#ff4d4f' }}>
            退出
          </button>
        </div>
      </div>

      {/* Create new exam */}
      <div style={styles.createCard}>
        <h3 style={{ marginBottom: '12px' }}>创建新考试</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            placeholder="考试标题 (必填)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={styles.input}
          />
          <input
            placeholder="考试描述 (可选)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ ...styles.input, flex: 2 }}
          />
          <button onClick={handleCreate} disabled={loading || !title.trim()} style={styles.btn}>
            创建
          </button>
        </div>
      </div>

      {/* Exam list */}
      <div>
        {exams.map((exam) => (
          <div key={exam.id} style={styles.examCard}>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginBottom: '4px' }}>
                {exam.title}
                {exam.is_published ? (
                  <span style={styles.publishedBadge}>已发布</span>
                ) : (
                  <span style={styles.draftBadge}>草稿</span>
                )}
              </h3>
              <p style={{ color: '#999', fontSize: '13px', marginBottom: '4px' }}>
                {exam.description || '无描述'}
              </p>
              <p style={{ color: '#999', fontSize: '12px' }}>
                {exam.case_count} 个病例 · {exam.question_count} 道题目 ·
                访问码: {exam.access_code} ·
                创建于 {new Date(exam.created_at).toLocaleDateString('zh-CN')}
                {isSuperadmin && exam.creator_name && (
                  <span style={{ marginLeft: '6px', color: '#1677ff' }}>· {exam.creator_name}</span>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => copyLink(getExamUrl(exam.access_code))} style={styles.actionBtn}>
                复制链接
              </button>
              <button onClick={() => showQrCode(exam.access_code, exam.title)} style={{ ...styles.actionBtn, color: '#1677ff', borderColor: '#91caff' }}>
                二维码
              </button>
              <button onClick={() => navigate(`/admin/exams/${exam.id}/edit`)} style={styles.actionBtn}>
                编辑
              </button>
              <button onClick={() => navigate(`/admin/exams/${exam.id}/statistics`)} style={styles.actionBtn}>
                统计
              </button>
              <button onClick={() => handleTogglePublish(exam.id)} style={{ ...styles.actionBtn, color: exam.is_published ? '#faad14' : '#52c41a' }}>
                {exam.is_published ? '取消发布' : '发布'}
              </button>
              <button onClick={() => handleDelete(exam.id)} style={{ ...styles.actionBtn, color: '#ff4d4f' }}>
                删除
              </button>
            </div>
          </div>
        ))}
        {exams.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', padding: '40px' }}>暂无考试，请创建新的考试</p>
        )}
      </div>

      {/* 考试答题二维码弹窗 */}
      {qrUrl && (
        <div style={styles.modalOverlay} onClick={() => setQrUrl(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '4px', fontSize: '16px', color: '#333' }}>{qrTitle}</h3>
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>考生可使用手机扫码或浏览器访问直接作答</p>
            <QRCode value={qrUrl} size={220} bordered={false} />
            <p style={{ fontSize: '12px', color: '#666', marginTop: '12px', wordBreak: 'break-all', maxWidth: '240px', textAlign: 'center' }}>
              {qrUrl}
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => copyLink(qrUrl)} style={styles.qrCopyBtn}>
                复制链接
              </button>
              <button onClick={() => setQrUrl(null)} style={styles.qrCloseBtn}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  createCard: {
    background: '#fff',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  input: {
    flex: 1,
    minWidth: '180px',
    padding: '10px 14px',
    fontSize: '14px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    outline: 'none',
  },
  btn: {
    padding: '10px 20px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  examCard: {
    background: '#fff',
    padding: '16px 20px',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    flexWrap: 'wrap',
  },
  publishedBadge: {
    fontSize: '11px',
    background: '#e6fffb',
    color: '#13c2c2',
    padding: '2px 8px',
    borderRadius: '4px',
    marginLeft: '8px',
    border: '1px solid #87e8de',
  },
  draftBadge: {
    fontSize: '11px',
    background: '#fff7e6',
    color: '#fa8c16',
    padding: '2px 8px',
    borderRadius: '4px',
    marginLeft: '8px',
    border: '1px solid #ffd591',
  },
  actionBtn: {
    padding: '6px 14px',
    fontSize: '13px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalCard: {
    background: '#fff',
    padding: '28px 32px',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '300px',
  },
  qrCopyBtn: {
    padding: '8px 20px',
    fontSize: '14px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  qrCloseBtn: {
    padding: '8px 20px',
    fontSize: '14px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};
