import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  getAdminRegistrationStatus, setAdminRegistrationStatus,
} from '../../api/exam';
import { useAdminStore } from '../../store/adminStore';

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const isSuperadmin = useAdminStore((s) => s.isSuperadmin);
  const token = useAdminStore((s) => s.token);
  const [users, setUsers] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [regOpen, setRegOpen] = useState(false);
  const [regToggling, setRegToggling] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await listAdminUsers();
      setUsers(res.data.users);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return; }
    if (!isSuperadmin) { navigate('/admin/dashboard'); return; }
    fetchUsers();
    getAdminRegistrationStatus()
      .then((res) => setRegOpen(!!res.data.open))
      .catch(() => setRegOpen(false));
  }, []);

  const handleToggleReg = async () => {
    setRegToggling(true);
    try {
      await setAdminRegistrationStatus(!regOpen);
      setRegOpen(!regOpen);
    } catch (e: any) {
      alert(e.response?.data?.detail || '操作失败');
    } finally {
      setRegToggling(false);
    }
  };

  const handleCreate = async () => {
    if (!newUsername.trim() || !newDisplayName.trim() || newPassword.length < 6) {
      alert('请填写完整信息，密码至少6位');
      return;
    }
    setCreating(true);
    try {
      await createAdminUser(newUsername.trim(), newDisplayName.trim(), newPassword);
      setNewUsername(''); setNewDisplayName(''); setNewPassword('');
      await fetchUsers();
    } catch (e: any) {
      alert(e.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (userId: number) => {
    const data: any = {};
    if (editDisplayName.trim()) data.display_name = editDisplayName.trim();
    if (editPassword) {
      if (editPassword.length < 6) { alert('密码至少6位'); return; }
      data.password = editPassword;
    }
    try {
      await updateAdminUser(userId, data);
      setEditingId(null);
      await fetchUsers();
    } catch (e: any) {
      alert(e.response?.data?.detail || '更新失败');
    }
  };

  const handleDelete = async (userId: number, username: string) => {
    if (!confirm(`确定删除用户 "${username}" 吗？该用户创建的问卷将保留。`)) return;
    try {
      await deleteAdminUser(userId);
      await fetchUsers();
    } catch (e: any) {
      alert(e.response?.data?.detail || '删除失败');
    }
  };

  const handleToggleActive = async (userId: number, currentActive: boolean) => {
    try {
      await updateAdminUser(userId, { is_active: !currentActive });
      await fetchUsers();
    } catch (e: any) {
      alert(e.response?.data?.detail || '操作失败');
    }
  };

  return (
    <div className="container" style={{ paddingTop: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button onClick={() => navigate('/admin/dashboard')} style={styles.backBtn}>← 返回</button>
        <h1 style={{ fontSize: '22px', margin: 0 }}>管理员用户管理</h1>
      </div>

      {/* Create new admin */}
      <div style={styles.card}>
        <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>新增管理员</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            placeholder="登录账号"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            style={styles.input}
          />
          <input
            placeholder="显示名称"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            style={styles.input}
          />
          <input
            type="password"
            placeholder="密码 (至少6位)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={styles.input}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            style={styles.primaryBtn}
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>

      {/* Self-registration switch */}
      <div style={styles.card}>
        <h3 style={{ marginBottom: '6px', fontSize: '15px' }}>管理员自助注册</h3>
        <p style={{ fontSize: '12px', color: '#999', margin: '0 0 12px' }}>
          开启后，登录页面将显示注册入口，新注册账号为普通管理员（仅能管理自己创建的问卷）。
          管理员可在此随时关闭。
        </p>
        <button
          onClick={handleToggleReg}
          disabled={regToggling}
          style={{
            ...styles.primaryBtn,
            background: regOpen ? '#ff4d4f' : '#52c41a',
            width: 'auto',
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          {regToggling ? '处理中...' : regOpen ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}
        </button>
      </div>

      {/* User list */}
      <div>
        {users.map((user) => (
          <div key={user.id} style={styles.userCard}>
            {editingId === user.id ? (
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <input
                    placeholder={`显示名称 (原: ${user.display_name})`}
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    style={styles.input}
                  />
                  <input
                    type="password"
                    placeholder="新密码 (留空不修改)"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleSaveEdit(user.id)} style={styles.primaryBtn}>保存</button>
                  <button onClick={() => setEditingId(null)} style={styles.secondaryBtn}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500, fontSize: '15px' }}>{user.display_name}</span>
                    <span style={{ fontSize: '12px', color: '#999' }}>@{user.username}</span>
                    {user.is_superadmin && (
                      <span style={styles.superBadge}>超管</span>
                    )}
                    {!user.is_active && (
                      <span style={styles.inactiveBadge}>已禁用</span>
                    )}
                  </div>
                  <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
                    创建于 {new Date(user.created_at).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                {!user.is_superadmin && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        setEditingId(user.id);
                        setEditDisplayName('');
                        setEditPassword('');
                      }}
                      style={styles.actionBtn}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleToggleActive(user.id, user.is_active)}
                      style={{ ...styles.actionBtn, color: user.is_active ? '#faad14' : '#52c41a' }}
                    >
                      {user.is_active ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleDelete(user.id, user.username)}
                      style={{ ...styles.actionBtn, color: '#ff4d4f' }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  input: {
    flex: 1,
    minWidth: '160px',
    padding: '9px 13px',
    fontSize: '14px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    outline: 'none',
  },
  primaryBtn: {
    padding: '9px 18px',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  secondaryBtn: {
    padding: '9px 18px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  userCard: {
    background: '#fff',
    padding: '14px 18px',
    borderRadius: '8px',
    marginBottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    flexWrap: 'wrap',
  },
  actionBtn: {
    padding: '5px 12px',
    fontSize: '13px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  superBadge: {
    fontSize: '11px',
    background: '#e6f4ff',
    color: '#1677ff',
    padding: '1px 6px',
    borderRadius: '4px',
    border: '1px solid #91caff',
  },
  inactiveBadge: {
    fontSize: '11px',
    background: '#fff2f0',
    color: '#ff4d4f',
    padding: '1px 6px',
    borderRadius: '4px',
    border: '1px solid #ffccc7',
  },
  backBtn: {
    padding: '6px 14px',
    fontSize: '14px',
    background: '#fff',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};
