import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getResult } from '../../api/exam';

export default function ResultPage() {
  const { accessCode, sessionId } = useParams<{ accessCode: string; sessionId: string }>();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !accessCode) return;
    getResult(Number(sessionId), accessCode)
      .then((res) => setResult(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessCode, sessionId]);

  if (loading) return <div style={styles.wrapper}><p>加载中...</p></div>;
  if (!result) return <div style={styles.wrapper}><p>结果不存在</p></div>;

  const scoreColor = (result.score_percentage || 0) >= 60 ? '#52c41a' : '#ff4d4f';

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>答题完成</h1>
        <p style={styles.name}>{result.user_name}，感谢您的参与！</p>

        <div style={styles.scoreCard}>
          <div style={{ ...styles.scoreNumber, color: scoreColor }}>
            {result.score_percentage?.toFixed(1)}%
          </div>
          <p style={styles.scoreDetail}>
            答对 {result.total_score} 题 / 共 {result.total_questions} 题
          </p>
        </div>

        {result.records && (
          <div style={styles.records}>
            <h3 style={{ fontSize: '15px', marginBottom: '12px' }}>答卷明细</h3>
            {result.records.map((r: any, idx: number) => (
              <div key={idx} style={styles.recordItem}>
                <span style={{
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '12px',
                  background: r.is_correct ? '#f6ffed' : r.user_answer === null ? '#fafafa' : '#fff2f0',
                  color: r.is_correct ? '#52c41a' : r.user_answer === null ? '#999' : '#ff4d4f',
                  marginRight: '10px',
                }}>
                  {r.is_correct ? '正确' : r.user_answer === null ? '未作答' : '错误'}
                </span>
                <span style={{ fontSize: '13px' }}>
                  您的答案: {r.user_answer || '(未作答)'}
                </span>
              </div>
            ))}
          </div>
        )}

        
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
    maxWidth: '480px',
    textAlign: 'center',
  },
  title: { fontSize: '24px', marginBottom: '4px', color: '#333' },
  name: { fontSize: '14px', color: '#666', marginBottom: '20px' },
  scoreCard: {
    background: '#fafafa',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
  },
  scoreNumber: { fontSize: '48px', fontWeight: 700 },
  scoreDetail: { fontSize: '14px', color: '#999', marginTop: '4px' },
  records: {
    textAlign: 'left',
    maxHeight: '300px',
    overflowY: 'auto',
    padding: '4px 0',
    marginBottom: '20px',
  },
  recordItem: {
    padding: '6px 0',
    borderBottom: '1px solid #f0f0f0',
    display: 'flex',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500,
  },
};
