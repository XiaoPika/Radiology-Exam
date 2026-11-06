import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin, publicRegisterAdmin, getAdminRegistrationStatus } from '../../api/exam';
import { useAdminStore } from '../../store/adminStore';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Self-registration state
  const [regOpen, setRegOpen] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [rUsername, setRUsername] = useState('');
  const [rDisplayName, setRDisplayName] = useState('');
  const [rPassword, setRPassword] = useState('');
  const [rError, setRError] = useState('');
  const [registering, setRegistering] = useState(false);

  const navigate = useNavigate();
  const setToken = useAdminStore((s) => s.setToken);

  useEffect(() => {
    getAdminRegistrationStatus()
      .then((res) => setRegOpen(!!res.data.open))
      .catch(() => setRegOpen(false));
  }, []);

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminLogin(username.trim(), password);
      setToken(
        res.data.access_token,
        res.data.username,
        res.data.display_name,
        res.data.is_superadmin,
      );
      navigate('/admin/dashboard');
    } catch (e: any) {
      setError(e.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!rUsername.trim() || !rDisplayName.trim() || rPassword.length < 6) {
      setRError('请填写完整信息，密码至少6位');
      return;
    }
    setRegistering(true);
    setRError('');
    try {
      await publicRegisterAdmin(rUsername.trim(), rDisplayName.trim(), rPassword);
      // Auto-fill login form so they can log in immediately
      setUsername(rUsername.trim());
      setPassword('');
      setShowRegister(false);
      setRUsername(''); setRDisplayName(''); setRPassword('');
      setRError('');
      setError('注册成功，请登录');
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      let msg = '注册失败';
      if (typeof detail === 'string') msg = detail;
      else if (Array.isArray(detail)) msg = detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
      setRError(msg);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.title}>医学影像问卷系统</h1>
        <p style={styles.subtitle}>登录以创建/管理问卷和病例</p>
        <input
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          style={styles.input}
          autoFocus
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          style={styles.input}
        />
        {error && <p style={styles.error}>{error}</p>}
        <button onClick={handleLogin} disabled={loading || !username.trim() || !password} style={styles.button}>
          {loading ? '登录中...' : '登录'}
        </button>

        {/* Self-registration entry */}
        {regOpen ? (
          <p style={styles.registerEntry}>
            没有账号？
            <span style={styles.linkLike} onClick={() => setShowRegister(true)}>注册</span>
          </p>
        ) : (
          <p style={styles.closedHint}></p>
        )}
        <p style={styles.closedHint}>如需账号请联系系统管理员</p>
      </div>

      {/* Registration modal */}
      {showRegister && (
        <div style={styles.overlay} onClick={() => setShowRegister(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '18px', color: '#333' }}>注册</h3>
            <p style={{ fontSize: '12px', color: '#999', margin: '0 0 16px' }}>
             
            </p>
            <input
              type="text"
              placeholder="登录用户名"
              value={rUsername}
              onChange={(e) => setRUsername(e.target.value)}
              style={styles.input}
            />
            <input
              type="text"
              placeholder="显示名称（如：张医生）"
              value={rDisplayName}
              onChange={(e) => setRDisplayName(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              placeholder="密码（至少6位）"
              value={rPassword}
              onChange={(e) => setRPassword(e.target.value)}
              style={styles.input}
            />
            {rError && <p style={styles.error}>{rError}</p>}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => setShowRegister(false)}
                style={styles.secondaryBtn}
              >
                取消
              </button>
              <button
                onClick={handleRegister}
                disabled={registering}
                style={styles.primaryBtn}
              >
                {registering ? '注册中...' : '注册'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  },
  card: {
    background: '#fff',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    width: '90%',
    maxWidth: '400px',
    textAlign: 'center',
  },
  title: { fontSize: '24px', marginBottom: '8px', color: '#333' },
  subtitle: { fontSize: '14px', color: '#999', marginBottom: '24px' },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '1px solid #d9d9d9',
    borderRadius: '8px',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
  },
  error: { color: '#ff4d4f', fontSize: '14px', marginBottom: '8px' },
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
  registerEntry: {
    fontSize: '13px',
    color: '#666',
    marginTop: '16px',
    marginBottom: 0,
  },
  linkLike: {
    color: '#1677ff',
    cursor: 'pointer',
    marginLeft: '4px',
  },
  closedHint: {
    fontSize: '12px',
    color: '#999',
    marginTop: '16px',
    marginBottom: 0,
  },
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    padding: '28px 32px',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '420px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  primaryBtn: {
    flex: 1,
    padding: '11px',
    fontSize: '15px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  secondaryBtn: {
    flex: 1,
    padding: '11px',
    fontSize: '15px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '8px',
    cursor: 'pointer',
  },
};
