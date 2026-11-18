import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import { renderAdminPortal, wireAdminPortal } from './admin-portal.js';
import '../css/style.css';
import './tailwind.css';
import '../js/config.js';

const config = window.KINDRED_CONFIG || {};
const supabaseClient = config.supabaseUrl && config.supabaseAnonKey
  ? createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;
window.supabase = { createClient: () => supabaseClient, client: supabaseClient };

function replaceMain(markup, replacement) {
  const start = markup.indexOf('<main');
  const end = markup.indexOf('</main>', start);
  if (start < 0 || end < 0) return markup;
  return `${markup.slice(0, start)}${replacement}${markup.slice(end + '</main>'.length)}`;
}

function KindredApp() {
  const [view, setView] = useState({ page: location.search, html: '', revision: 0 });
  const adminRequest = useRef(0);

  useEffect(() => {
    window.KINDRED_RENDER = (html, page) => {
      const request = ++adminRequest.current;
      if (page === 'admin' && supabaseClient) {
        const loading = '<main class="app-shell"><div class="wrap"><div class="panel empty">Loading administrator portal…</div></div></main>';
        flushSync(() => setView(current => ({
          page,
          html: replaceMain(html, loading),
          revision: current.revision + 1
        })));
        renderAdminPortal(supabaseClient).then(adminHtml => {
          if (request !== adminRequest.current) return;
          flushSync(() => setView(current => ({
            page,
            html: replaceMain(current.html, adminHtml),
            revision: current.revision + 1
          })));
        }).catch(error => {
          if (request !== adminRequest.current) return;
          const message = String(error?.message || 'Administrator portal could not be loaded.')
            .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
          const failure = `<main class="app-shell"><div class="wrap"><div class="panel alert error" role="alert">${message}</div></div></main>`;
          flushSync(() => setView(current => ({
            page,
            html: replaceMain(current.html, failure),
            revision: current.revision + 1
          })));
        });
        return;
      }
      flushSync(() => setView(current => ({ page, html, revision: current.revision + 1 })));
    };
    import('../js/app.js');
    return () => { delete window.KINDRED_RENDER; };
  }, []);

  useEffect(() => {
    if (view.page !== 'admin' || !supabaseClient) return undefined;
    return wireAdminPortal(supabaseClient, async notice => {
      const adminHtml = await renderAdminPortal(supabaseClient, notice);
      setView(current => ({
        ...current,
        html: replaceMain(current.html, adminHtml),
        revision: current.revision + 1
      }));
    });
  }, [view.page, view.revision]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
      key={`${view.page}-${view.revision}`}
        className="min-h-screen"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onAnimationComplete={() => window.dispatchEvent(new Event('kindred-view-ready'))}
        dangerouslySetInnerHTML={{ __html: view.html || '<div class="boot"><span class="brand-symbol">k</span> Kindred Konnect</div>' }}
      />
    </AnimatePresence>
  );
}

createRoot(document.getElementById('app')).render(<KindredApp />);
