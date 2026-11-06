interface QuestionProps {
  question: {
    id: number;
    question_type: string;
    question_text: string;
    options: string[] | null;
    sort_order: number;
    locked?: boolean;
    // Backend flag: true when correct_answer contains multiple answers
    // (separated by the full-width semicolon). Drives radio vs checkbox.
    is_multi?: boolean;
  };
  selectedAnswer: string;
  onSelect: (answer: string) => void;
  locked?: boolean;
}

export default function QuestionCard({ question, selectedAnswer, onSelect, locked }: QuestionProps) {
  const isLocked = locked || question.locked;
  return (
    <div style={{ ...styles.card, ...(isLocked ? styles.cardLocked : {}) }}>
      <p style={styles.text}>
        {question.question_text}
        {isLocked && <span style={styles.lockedBadge}>已锁定</span>}
      </p>

      {question.question_type === 'multiple_choice' && question.options ? (
        <div style={styles.options}>
          {(() => {
            // is_multi (backend flag based on correct_answer cardinality):
            //   true  → multiple correct answers → checkbox multi-select,
            //           selectedAnswer stored as a "；"-joined sorted string.
            //   false → single correct answer → radio single-select,
            //           selectedAnswer stored as a single letter.
            // Both forms are graded correctly by the backend
            // (_check_answer treats a single-letter answer as a one-element
            // set, matching a one-element correct set).
            const isMulti = !!question.is_multi;
            const selectedSet = new Set(
              String(selectedAnswer || '')
                .replace(/;/g, '；')
                .split('；')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean),
            );
            return (Array.isArray(question.options) ? question.options : []).map((opt: string, idx: number) => {
              const optLetter = String.fromCharCode(65 + idx); // A, B, C, D...
              const isSelected = isMulti ? selectedSet.has(optLetter) : selectedAnswer === optLetter;

              const toggleMulti = () => {
                if (isLocked) return;
                const next = new Set(selectedSet);
                if (next.has(optLetter)) next.delete(optLetter);
                else next.add(optLetter);
                const joined = Array.from(next).sort().join('；');
                onSelect(joined);
              };

              return (
                <label
                  key={idx}
                  onClick={(e) => {
                    if (!isMulti) return; // radio uses native onChange
                    e.preventDefault();
                    toggleMulti();
                  }}
                  style={isSelected ? { ...styles.optionSelected, ...(isLocked ? styles.optionLocked : {}) } : { ...styles.option, ...(isLocked ? styles.optionLocked : {}) }}
                >
                  <input
                    type={isMulti ? 'checkbox' : 'radio'}
                    name={`q_${question.id}`}
                    value={optLetter}
                    checked={isSelected}
                    onChange={() => {
                      if (!isLocked) onSelect(optLetter);
                    }}
                    disabled={isLocked}
                    style={{ display: 'none' }}
                  />
                  <span
                    style={{
                      ...styles.optionLetter,
                      ...(isSelected ? styles.optionLetterSelected : {}),
                      ...(isLocked ? { background: '#e0e0e0' } : {}),
                    }}
                  >
                    {optLetter}
                  </span>
                  <span>{opt.replace(/^[A-Z][.、]\s*/, '')}</span>
                </label>
              );
            });
          })()}
          {isLocked && !selectedAnswer && (
            <p style={styles.emptyHint}>（未作答）</p>
          )}
        </div>
      ) : (
        <>
          <input
            type="text"
            placeholder={isLocked ? '' : '请输入您的答案'}
            value={selectedAnswer}
            onChange={(e) => onSelect(e.target.value)}
            disabled={isLocked}
            readOnly={isLocked}
            style={{ ...styles.input, ...(isLocked ? styles.inputLocked : {}) }}
          />
          {isLocked && !selectedAnswer && (
            <p style={styles.emptyHint}>（未作答）</p>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '12px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  cardLocked: {
    background: '#f5f5f5',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  text: {
    fontSize: '15px',
    fontWeight: 500,
    marginBottom: '12px',
    color: '#333',
  },
  lockedBadge: {
    display: 'inline-block',
    fontSize: '11px',
    color: '#999',
    background: '#eaeaea',
    padding: '1px 8px',
    borderRadius: '10px',
    marginLeft: '8px',
    fontWeight: 400,
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #e8e8e8',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
    color: '#333',
  },
  optionSelected: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '2px solid #1677ff',
    background: '#e6f7ff',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
  },
  optionLocked: {
    cursor: 'not-allowed',
    color: '#888',
  },
  optionLetter: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: '#f0f0f0',
    fontSize: '13px',
    fontWeight: 600,
  },
  optionLetterSelected: {
    background: '#1677ff',
    color: '#fff',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    fontSize: '15px',
    border: '1px solid #d9d9d9',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  inputLocked: {
    background: '#f0f0f0',
    color: '#888',
    border: '1px solid #e0e0e0',
    cursor: 'not-allowed',
  },
  emptyHint: {
    fontSize: '12px',
    color: '#999',
    marginTop: '6px',
  },
};
