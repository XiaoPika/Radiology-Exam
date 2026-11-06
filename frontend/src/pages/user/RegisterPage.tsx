import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getExamInfo, registerUser, getExamCases } from '../../api/exam';
import { useExamStore } from '../../store/examStore';

export default function RegisterPage() {
  const { accessCode } = useParams<{ accessCode: string }>();
  const navigate = useNavigate();
  const [examInfo, setExamInfo] = useState<any>(null);
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('影像医学中心');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [prefetchedCases, setPrefetchedCases] = useState<any[]>([]);
  const store = useExamStore();

  useEffect(() => {
    if (!accessCode) return;
    getExamInfo(accessCode).then(res => setExamInfo(res.data)).catch(console.error);
  }, [accessCode]);

  // Auto-resume: the store is now persisted to sessionStorage (see
  // examStore.ts), so a forced page reload (Vite HMR full-reload, mobile tab
  // discard/restore, an accidental refresh) between registering and finishing
  // the quiz no longer wipes it. If this tab already has a live session for
  // *this exact exam*, skip straight to the quiz instead of asking the user
  // to type their name again — that re-ask was the visible symptom of the
  // underlying state loss.
  useEffect(() => {
    if (!accessCode) return;
    if (!(store.sessionId && store.userName && store.accessCode === accessCode)) return;

    // Avoid flashing the empty registration form for the instant it takes
    // to confirm a resume is possible.
    setResuming(true);
    let cancelled = false;
    (async () => {
      try {
        let cases = store.cases;
        if (!cases || cases.length === 0) {
          const casesRes = await getExamCases(accessCode);
          if (cancelled) return;
          cases = casesRes.data.cases;
          store.setCases(cases);
        }
        if (!cancelled && cases && cases.length > 0) {
          navigate(`/exam/${accessCode}/quiz`, { replace: true });
          return;
        }
      } catch {
        // Exam unpublished / cases fetch failed — fall through and let the
        // user register normally via the form below.
      }
      if (!cancelled) setResuming(false);
    })();
    return () => { cancelled = true; };
    // Only re-run if the access code changes; store fields are read once at
    // effect-run time on purpose (this is a one-shot resume check, not a sync).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode]);

  // Start sequential DICOM prefetch as early as possible — even before the user
  // has typed their name.  The prefetcher is a module-level singleton (see
  // dicomPrefetcher.ts) so it keeps running after this component unmounts
  // when the user navigates to the quiz page.  It downloads one frame at a time
  // to give each file the full 100 KB/s instead of splitting bandwidth across
  // all files simultaneously.
  useEffect(() => {
    if (!accessCode) return;
    let cancelled = false;
    const prefetcherPromise = import('../../utils/dicomPrefetcher');
    getExamCases(accessCode)
      .then(async (res) => {
        const cases = res.data.cases || [];
        if (cancelled) return;
        setPrefetchedCases(cases);
        if (cases.length) {
          const { startPrefetch } = await prefetcherPromise;
          if (!cancelled) startPrefetch(cases);
        }
      })
      .catch(() => {/* exam not published or network error — silently skip */});
    // No cleanup abort: the prefetcher intentionally outlives this component.
    return () => { cancelled = true; };
  }, [accessCode]);

  const handleStart = async () => {
    if (!name.trim()) {
      setError('请输入姓名');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await registerUser(accessCode!, name, department || undefined, employeeId || undefined);
      store.setSession(res.data.session_id, res.data.user_id, res.data.user_name);
      store.setExamInfo(accessCode!, res.data.exam_title);

      // If the prior session is already done, clear the store so a future visit
      // shows the registration form instead of auto-resuming to completion.
      if (res.data.is_completed) {
        store.reset();
        navigate(`/exam/${accessCode}/result/${res.data.session_id}`, { replace: true });
        return;
      }

      // Reuse the cases fetched for preloading; fall back to the API if the
      // user starts before that request has finished.
      const cases = prefetchedCases.length
        ? prefetchedCases
        : (await getExamCases(accessCode!)).data.cases;
      store.setCases(cases);

      navigate(`/exam/${accessCode}/quiz`);
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      let msg = '注册失败';
      if (typeof detail === 'string') {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!examInfo || resuming) {
    return (
      <div style={styles.wrapper}>
        <p>{resuming ? '正在恢复答题进度...' : '加载中...'}</p>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>{examInfo.title}</h1>
        {examInfo.description && <p style={styles.desc}>{examInfo.description}</p>}
        <div style={styles.info}>
          <span>{examInfo.case_count} 个病例</span>
          <span>·</span>
          <span>{examInfo.question_count} 道题目</span>
        </div>

        <div style={styles.form}>
          <label style={styles.label}>
            姓名 <span style={{ color: '#ff4d4f' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="请输入您的姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            autoFocus
          />

          <label style={styles.label}>工号 (选填)</label>
          <input
            type="text"
            placeholder="请输入您的工号"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={styles.input}
          />

          <label style={styles.label}>部门</label>
          <input
            type="text"
            placeholder="请输入您的部门"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            style={styles.input}
          />

          {error && <p style={styles.error}>{error}</p>}

          <button onClick={handleStart} disabled={loading} style={styles.button}>
            {loading ? '加载中...' : '开始答题'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '20px',
  },
  card: {
    background: '#fff',
    padding: '32px',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    width: '100%',
    maxWidth: '440px',
  },
  title: { fontSize: '22px', marginBottom: '4px', color: '#333', textAlign: 'center' },
  desc: { fontSize: '14px', color: '#666', textAlign: 'center', marginBottom: '8px' },
  info: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    fontSize: '13px',
    color: '#999',
    marginBottom: '20px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '14px', fontWeight: 500, color: '#333', marginTop: '8px' },
  input: {
    width: '100%',
    padding: '10px 14px',
    fontSize: '15px',
    border: '1px solid #d9d9d9',
    borderRadius: '8px',
    outline: 'none',
    marginTop: '4px',
    boxSizing: 'border-box',
  },
  error: { color: '#ff4d4f', fontSize: '14px', marginTop: '8px' },
  button: {
    width: '100%',
    padding: '14px',
    fontSize: '17px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500,
    marginTop: '20px',
  },
};
