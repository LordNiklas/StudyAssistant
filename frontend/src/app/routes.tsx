import { createBrowserRouter } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { SubjectsView } from './components/SubjectsView';
import { SubjectDetailView } from './components/SubjectDetailView';
import { LlmView } from './components/LlmView';
import { AssessmentView } from './components/AssessmentView';
import { ResultView } from './components/ResultView';
import { LearningPlanView } from './components/LearningPlanView';
import { GuidedLearningView } from './components/GuidedLearningView';
import { PostExamRecheckView } from './components/PostExamRecheckView';
import { FlashcardsView } from './components/FlashcardsView';
import { FlashcardsMenuView } from './components/FlashcardsMenuView';
import { FlashcardsAllView } from './components/FlashcardsAllView';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { SettingsPage } from './components/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, Component: SubjectsView },
      { path: 'subject/:id', Component: SubjectDetailView },
      { path: 'llm', Component: LlmView },
      { path: 'assessment/:subjectId', Component: AssessmentView },
      { path: 'result/:subjectId', Component: ResultView },
      { path: 'learning-plan/:subjectId', Component: LearningPlanView },
      { path: 'guided-learning/:subjectId', Component: GuidedLearningView },
      { path: 'post-exam/:subjectId', Component: PostExamRecheckView },
      { path: 'flashcards', Component: FlashcardsMenuView },
      { path: 'flashcards/all', Component: FlashcardsAllView },
      { path: 'flashcards/:subjectId', Component: FlashcardsView },
      { path: 'settings', Component: SettingsPage },
    ],
  },
  { path: '/login', Component: LoginPage },
  { path: '/register', Component: RegisterPage },
]);
