import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ExamState {
  // Session
  sessionId: number | null;
  userId: number | null;
  userName: string;

  // Current exam
  accessCode: string;
  examTitle: string;
  cases: any[];
  currentCaseIndex: number;

  // Quiz state
  answers: Record<number, string>;  // questionId -> answer

  // Actions
  setSession: (sessionId: number, userId: number, userName: string) => void;
  setExamInfo: (accessCode: string, title: string) => void;
  setCases: (cases: any[]) => void;
  setCurrentCaseIndex: (index: number) => void;
  setAnswer: (questionId: number, answer: string) => void;
  clearAnswers: () => void;
  reset: () => void;
}

// Persisted to sessionStorage (not localStorage): survives an in-tab reload
// (Vite HMR full-reload, mobile browser tab discard/restore, an accidental
// refresh) without forcing the user to re-enter their name, but still clears
// once the tab is actually closed so a shared/kiosk device doesn't leak one
// doctor's session into the next. Without this, any forced reload between
// registration and finishing the quiz wiped the in-memory store and bounced
// the user back to a blank registration form.
export const useExamStore = create<ExamState>()(
  persist(
    (set) => ({
      sessionId: null,
      userId: null,
      userName: '',
      accessCode: '',
      examTitle: '',
      cases: [],
      currentCaseIndex: 0,
      answers: {},

      setSession: (sessionId, userId, userName) =>
        set({ sessionId, userId, userName }),

      setExamInfo: (accessCode, examTitle) =>
        set({ accessCode, examTitle }),

      setCases: (cases) => set({ cases }),

      setCurrentCaseIndex: (index) => set({ currentCaseIndex: index }),

      setAnswer: (questionId, answer) =>
        set((state) => ({
          answers: { ...state.answers, [questionId]: answer },
        })),

      clearAnswers: () => set({ answers: {} }),

      reset: () =>
        set({
          sessionId: null,
          userId: null,
          userName: '',
          accessCode: '',
          examTitle: '',
          cases: [],
          currentCaseIndex: 0,
          answers: {},
        }),
    }),
    {
      name: 'radiology-exam-session',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
