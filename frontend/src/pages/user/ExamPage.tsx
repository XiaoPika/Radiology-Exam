import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCaseDetail, submitCaseAnswer, submitExam } from '../../api/exam';
import { useExamStore } from '../../store/examStore';
import DicomViewer from '../../components/DicomViewer/DicomViewer';
import QuestionCard from '../../components/QuestionCard';
import { prioritizeFrom, stop as stopPrefetch } from '../../utils/dicomPrefetcher';

export default function ExamPage() {
  const { accessCode } = useParams<{ accessCode: string }>();
  const navigate = useNavigate();
  const store = useExamStore();

  const [currentCase, setCurrentCase] = useState<any>(null);
  const [activeSeriesIdx, setActiveSeriesIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState<any>(null);

  const { sessionId, accessCode: storedCode, cases, currentCaseIndex, answers } = store;

  // Track which case we're currently "on" so answers for cases beyond the
  // current index cannot be edited retroactively.
  const [lockedCases, setLockedCases] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!sessionId || !accessCode) {
      navigate(`/exam/${accessCode || ''}`, { replace: true });
      return;
    }
    // No cases in the store (e.g. user deep-linked directly to /quiz
    // without passing through RegisterPage which populates store.cases).
    // Send them back to register, which fetches cases + resumes.
    if (!cases || cases.length === 0) {
      navigate(`/exam/${accessCode}`, { replace: true });
      return;
    }
    // Cancellation guard: React 18 StrictMode double-invokes this effect on
    // mount (no dependency changed, just the dev double-render), which fired
    // two concurrent loadCase() calls with no way to tell them apart. Both
    // hit the network and could resolve in either order, so whichever
    // response happened to land second would silently win — normally
    // harmless (same data), but a real footgun if a slower stale request
    // ever resolved after a newer one (e.g. rapid case navigation). Bind
    // each call to its own cancelled flag, flipped by the cleanup.
    // Reprioritize the background prefetcher so the current case's frames are
    // downloaded first.  Already-cached frames resolve instantly (force-cache),
    // so this just re-orders the queue without restarting completed work.
    // No cleanup: the prefetcher intentionally outlives this component.
    prioritizeFrom(currentCaseIndex, cases);

    let cancelled = false;
    loadCase(() => cancelled);
    return () => { cancelled = true; };
  }, [currentCaseIndex, sessionId, cases, accessCode]);

  const loadCase = async (isCancelled: () => boolean) => {
    if (!sessionId || !accessCode) return;
    const caseItem = cases[currentCaseIndex];
    if (!caseItem) return;

    setLoading(true);
    setMessage('');
    try {
      const res = await getCaseDetail(accessCode, caseItem.id, sessionId);
      if (isCancelled()) return;
      setCurrentCase(res.data);
      setActiveSeriesIdx(0);

      const caseLocked = !!res.data.answers_locked;
      // Pre-fill answers from previous submissions and remember lock state.
      res.data.questions?.forEach((q: any) => {
        if (q.previous_answer !== undefined && q.previous_answer !== null) {
          store.setAnswer(q.id, q.previous_answer);
        }
      });
      setLockedCases((prev) => ({ ...prev, [caseItem.id]: caseLocked }));
    } catch (e: any) {
      if (isCancelled()) return;
      // Already submitted.
      const status = e?.response?.status;
      if (status === 409) {
        navigate(`/exam/${accessCode}/result/${sessionId}`, { replace: true });
        return;
      }
      const detail = e?.response?.data?.detail;
      console.error(e);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  const handleNext = async () => {
    if (!sessionId || !currentCase || !accessCode) return;

    const caseAnswers: Record<string, string> = {};
    currentCase.questions?.forEach((q: any) => {
      const ans = answers[q.id];
      if (ans !== undefined && ans !== null && ans !== '') {
        caseAnswers[String(q.id)] = ans;
      }
    });

    // Persist current case answers before moving on.
    try {
      await submitCaseAnswer(accessCode, currentCase.id, sessionId, caseAnswers);
      setLockedCases((prev) => ({ ...prev, [currentCase.id]: true }));
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        // Already locked / submitted — sync lock state and fall through.
        setLockedCases((prev) => ({ ...prev, [currentCase.id]: true }));
      } else {
        setMessage(e.response?.data?.detail || '保存失败');
        return;
      }
    }

    if (currentCaseIndex < cases.length - 1) {
      store.setCurrentCaseIndex(currentCaseIndex + 1);
      store.clearAnswers();
    } else {
      // Last case - submit all
      await handleSubmitAll();
    }
  };

  const handleSubmitAll = async () => {
    if (!sessionId || !accessCode) return;
    setSubmitting(true);
    try {
      const res = await submitExam(accessCode, sessionId);
      stopPrefetch();
      setSubmitting(false);
      setResultData(res.data);
      setShowResult(true);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        // Already submitted — go to result page.
        store.reset();
        stopPrefetch();
        navigate(`/exam/${accessCode}/result/${sessionId}`, { replace: true });
        return;
      }
      setMessage(e.response?.data?.detail || '提交失败');
      setSubmitting(false);
    }
  };

  const isLastCase = !cases || cases.length === 0 ? false : currentCaseIndex >= cases.length - 1;

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: 40, textAlign: 'center' }}>
        <p>加载病例中...</p>
      </div>
    );
  }

  if (!currentCase) {
    return (
      <div className="container" style={{ paddingTop: 40, textAlign: 'center' }}>
        <p>没有更多病例</p>
      </div>
    );
  }

  const currentCaseLocked = !!lockedCases[currentCase.id];

  // Warnings when current case is already locked
  const renderLockedNotice = () =>
    currentCaseLocked ? (
      <div style={styles.lockedNotice}>
        该病例已作答并保存，答案已锁定不可修改。如需修改请联系管理员。
        <button
          onClick={() => handleNext()}
          style={{ ...styles.nextBtnInline, marginLeft: 12 }}
        >
          {isLastCase ? '提交答卷' : '下一病例'}
        </button>
      </div>
    ) : null;

  return (
    <div className="container" style={{ paddingTop: '16px', paddingBottom: '40px', maxWidth: '1000px' }}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={{ fontSize: '18px', margin: 0 }}>{store.examTitle}</h2>
        <span style={{ fontSize: '13px', color: '#666' }}>
          病例 {currentCaseIndex + 1} / {cases.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={styles.progressBar}>
        <div
          style={{
            ...styles.progressFill,
            width: `${((currentCaseIndex + 1) / cases.length) * 100}%`,
          }}
        />
      </div>

      {/* Series selector */}
      {currentCase.series && currentCase.series.length > 0 && (
        <div style={styles.seriesTabs}>
          {currentCase.series.map((s: any, idx: number) => (
            <button
              key={s.id}
              onClick={() => setActiveSeriesIdx(idx)}
              style={idx === activeSeriesIdx ? styles.seriesTabActive : styles.seriesTab}
            >
              {s.series_description || `序列 ${idx + 1}`} ({s.image_count}帧)
            </button>
          ))}
        </div>
      )}

      {/* DICOM Viewer */}
      <div style={styles.viewerContainer}>
        {currentCase.series && currentCase.series[activeSeriesIdx] && (
          <DicomViewer
            key={`${currentCase.dicom_folder}-${currentCase.series[activeSeriesIdx].series_folder}`}
            caseFolder={currentCase.dicom_folder}
            seriesIndex={(() => {
              const folder = currentCase.series[activeSeriesIdx].series_folder;
              const match = folder.match(/series_(\d+)$/);
              return match ? parseInt(match[1], 10) : activeSeriesIdx;
            })()}
            imageCount={currentCase.series[activeSeriesIdx].image_count}
          />
        )}
      </div>

      {/* Patient metadata */}
      <div style={styles.metaBar}>
        {currentCase.patient_sex && <span>性别: {currentCase.patient_sex}</span>}
        {currentCase.patient_age && <span>年龄: {currentCase.patient_age}</span>}
        {currentCase.study_description && <span>检查: {currentCase.study_description}</span>}
      </div>

      {/* Case notes */}
      {currentCase.notes && (
        <div style={styles.notes}>
          <strong>临床备注:</strong> {currentCase.notes}
        </div>
      )}

      {/* Questions */}
      <div style={{ marginTop: '16px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>请作答:</h3>
        {currentCase.questions?.map((q: any) => (
          <QuestionCard
            key={q.id}
            question={q}
            selectedAnswer={answers[q.id] || ''}
            onSelect={(ans) => store.setAnswer(q.id, ans)}
            locked={currentCaseLocked}
          />
        ))}
      </div>

      {/* Actions */}
      {message && (
        <p style={{ textAlign: 'center', color: message.includes('失败') ? '#ff4d4f' : '#52c41a', fontSize: '14px' }}>
          {message}
        </p>
      )}
      {renderLockedNotice()}
      <div style={styles.actions}>
        <button onClick={handleNext} style={styles.nextBtn} disabled={submitting}>
          {isLastCase ? (submitting ? '提交中...' : '提交答卷') : '下一病例'}
        </button>
      </div>

      {/* Submission overlay with spinner + result */}
      {submitting && (
        <div style={styles.overlay}>
          <div style={styles.overlayCard}>
            <div style={styles.spinner} />
            <p style={{ fontSize: '16px', color: '#333', marginTop: '16px' }}>正在提交答卷，请稍候...</p>
          </div>
        </div>
      )}

      {/* Result popup */}
      {showResult && resultData && (
        <div style={styles.overlay}>
          <div style={styles.overlayCard}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%', background: '#f6ffed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
              border: '3px solid #52c41a',
            }}>
              <span style={{ fontSize: '32px' }}>✓</span>
            </div>
            <h3 style={{ marginTop: '12px', color: '#333' }}>答卷提交成功</h3>
            <p style={{ fontSize: '15px', color: '#666', marginTop: '8px' }}>
              您的正确率为：
            </p>
            <p style={{
              fontSize: '42px', fontWeight: 700,
              color: resultData.score_percentage >= 60 ? '#52c41a' : '#ff4d4f',
              margin: '8px 0',
            }}>
              {resultData.score_percentage}%
            </p>
            <p style={{ fontSize: '13px', color: '#999' }}>
              答对 {resultData.total_score} 题 / 共 {resultData.total_questions} 题
            </p>
            <button
              onClick={() => {
                store.reset();
                navigate(`/exam/${accessCode}/result/${resultData.session_id}`);
              }}
              style={{
                marginTop: '20px', padding: '10px 32px', fontSize: '15px',
                background: '#1677ff', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              查看答卷详情
            </button>
            <p style={{ fontSize: '12px', color: '#999', marginTop: '12px' }}></p>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  progressBar: {
    height: '4px',
    background: '#e8e8e8',
    borderRadius: '2px',
    marginBottom: '16px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#1677ff',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  seriesTabs: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '12px',
  },
  seriesTab: {
    padding: '6px 14px',
    fontSize: '13px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '20px',
    cursor: 'pointer',
  },
  seriesTabActive: {
    padding: '6px 14px',
    fontSize: '13px',
    background: '#1677ff',
    color: '#fff',
    border: '1px solid #1677ff',
    borderRadius: '20px',
    cursor: 'pointer',
  },
  viewerContainer: {
    background: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  metaBar: {
    display: 'flex',
    gap: '16px',
    fontSize: '13px',
    color: '#666',
    padding: '8px 0',
  },
  notes: {
    background: '#fffbe6',
    border: '1px solid #ffe58f',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '14px',
    marginTop: '8px',
  },
  lockedNotice: {
    background: '#fff7e6',
    border: '1px solid #ffd591',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#ad6800',
    marginTop: '16px',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    marginTop: '16px',
    flexWrap: 'wrap',
  },
  nextBtnInline: {
    padding: '6px 16px',
    fontSize: '13px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  nextBtn: {
    padding: '10px 24px',
    fontSize: '15px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  overlay: {
    position: 'fixed' as const,
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
  overlayCard: {
    background: '#fff',
    padding: '32px 40px',
    borderRadius: '16px',
    textAlign: 'center' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    maxWidth: '400px',
    width: '90%',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e8e8e8',
    borderTop: '4px solid #1677ff',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 0.8s linear infinite',
  },
};
