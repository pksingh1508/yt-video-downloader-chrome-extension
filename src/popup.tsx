import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowUpRight, Check, CircleHelp, Film, Link2, LoaderCircle, Play, Youtube } from 'lucide-react';
import { api } from './api';
import { openStudio } from './studio';
import { canonicalYouTubeUrl, isActive, type Health, type Job } from './shared';
import '@fontsource-variable/geist';
import './popup.css';

function Popup() {
  const [url, setUrl] = useState('');
  const [tabUrl, setTabUrl] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [checked, setChecked] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [guide, setGuide] = useState(false);
  let valid = false;
  try { canonicalYouTubeUrl(url); valid = true; } catch { /* Show errors on submit. */ }

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        try {
          const current = canonicalYouTubeUrl(tab?.url || '');
          setTabUrl(current);
          setUrl(current);
        } catch { /* Paste is available on every page. */ }
      }).catch(() => {});
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const [nextHealth, nextJobs] = await Promise.all([api<Health>('/api/health'), api<Job[]>('/api/jobs')]);
        if (!stopped) { setHealth(nextHealth); setJobs(nextJobs); }
      } catch { if (!stopped) setHealth(null); }
      finally {
        if (!stopped) { setChecked(true); timer = setTimeout(refresh, 5000); }
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  async function launch(withLink: boolean) {
    setError('');
    setOpening(true);
    try {
      await openStudio(withLink ? url : undefined);
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) window.close();
    } catch (error) { setError((error as Error).message); }
    finally { setOpening(false); }
  }

  return <main className="popup">
    <header><span className="popup-brand"><i><Play size={16} fill="currentColor" /></i>PostReady<span>.</span></span><span className="chrome-label">FOR CHROME</span></header>
    <div className={`connection ${health?.ready ? 'ready' : ''}`} role="status"><span />{!checked ? 'Checking companion…' : health?.ready ? 'Local companion connected' : health ? 'Processing tools need setup' : 'Local companion is offline'}<button aria-label="Companion setup instructions" onClick={() => setGuide(!guide)}><CircleHelp size={15}/></button></div>
    {(guide || (checked && !health?.ready)) && <aside className="setup"><strong>{health ? 'Finish processing setup' : 'Start your local companion'}</strong><p>In the extension project folder, run:</p><code>{health ? 'npm run setup' : 'npm start'}</code><p>{health ? 'Restart the companion after setup.' : 'Keep it running while preparing and saving videos.'} Your videos are processed on this computer.</p></aside>}
    <section className="popup-intro"><span className="kicker">YOUTUBE → X</span><h1>A good moment.<br/><span>Ready to share.</span></h1><p>Choose a clip. Get an upload-ready MP4.</p></section>
    <form onSubmit={event => { event.preventDefault(); void launch(true); }}>
      <label htmlFor="video-link">YouTube video link</label>
      <div className="popup-input"><Link2 size={16}/><input id="video-link" type="url" placeholder="https://youtube.com/watch?v=…" value={url} onChange={event => { setUrl(event.target.value); setError(''); }} required /></div>
      {tabUrl && <button className="use-tab" type="button" onClick={() => { setUrl(tabUrl); setError(''); }}><Youtube size={14}/>Use current YouTube video<Check size={12}/></button>}
      {error && <p className="popup-error" role="alert">{error}</p>}
      <button className="popup-primary" disabled={!valid || opening} type="submit">{opening ? <LoaderCircle size={16} className="spin"/> : <Film size={16}/>}Choose clip & format<ArrowRight size={16}/></button>
    </form>
    <div className="popup-formats"><span><Check size={12}/>MP4</span><span>H.264 + AAC</span><span>720p / 1080p</span></div>
    <button className="open-studio" disabled={opening} onClick={() => void launch(false)}>Open workspace{jobs.some(isActive) ? <span>{jobs.filter(isActive).length} processing</span> : jobs.some(job => job.status === 'completed') ? <span>{jobs.filter(job => job.status === 'completed').length} ready</span> : null}<ArrowUpRight size={16}/></button>
    <footer>Clips keep processing when you close this popup.<br/>Only download videos you have permission to use.</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
