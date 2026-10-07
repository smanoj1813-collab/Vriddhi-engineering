// src/modules/admin/pages/QuestionBank.tsx
// Principal / HOD / admin entry point. The question bank is now ONE shared
// screen for every portal — see src/shared/components/question-bank/UnifiedQuestionBank.tsx.

import UnifiedQuestionBank, { type UnifiedQuestionBankTab } from '@/shared/components/question-bank/UnifiedQuestionBank';

export type QuestionBankTab = UnifiedQuestionBankTab;

export default function QuestionBank({ initialTab = 'college' }: { initialTab?: QuestionBankTab }) {
  return <UnifiedQuestionBank initialTab={initialTab} />;
}
