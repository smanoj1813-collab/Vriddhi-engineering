// src/modules/prep/routes.ts
//
// Public Prep catalog routes — the shareable, college-free URL for browsing
// the platform curriculum (issue: "I need a URL link for Prep studio where I
// can check and verify, without assigning a college").
//
// Deliberately OUTSIDE every RoleRoute/ProtectedRoute: the underlying API
// endpoints serve only PUBLISHED content to anonymous callers, so the page is
// safe to open from any shared link. Draft/in-review content stays visible
// only to the superadmin authoring studio.
//
// Lazy-loaded on purpose: PrepPublicViewer pulls katex + the papers/company
// views (~700 KB unminified). A static import would land all of that in the
// initial index chunk for every user, including students who never open /prep.

import { Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const PrepPublicViewer = lazy(() => import('./PrepPublicViewer'));

type PrepView = 'hub' | 'subject' | 'topic' | 'company' | 'papers' | 'paper' | 'repeats';

function lazyView(view: PrepView) {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          Loading prep…
        </div>
      }
    >
      <PrepPublicViewer view={view} />
    </Suspense>
  );
}

export const prepRoutes: RouteObject[] = [
  { path: '/prep', element: lazyView('hub') },
  { path: '/prep/subject/:subjectId', element: lazyView('subject') },
  { path: '/prep/subject/:subjectId/topic/:topicId', element: lazyView('topic') },
  { path: '/prep/company/:companyCode', element: lazyView('company') },
  // Previous-year university question papers (published only, like the rest).
  { path: '/prep/papers', element: lazyView('papers') },
  // Item 3.3 — repeated-question groupings. Declared BEFORE /prep/papers/:paperId
  // so 'repeats' can never be read as a paper id.
  { path: '/prep/papers/repeats', element: lazyView('repeats') },
  { path: '/prep/papers/:paperId', element: lazyView('paper') },
];
