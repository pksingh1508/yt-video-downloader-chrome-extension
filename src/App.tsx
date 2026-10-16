import { api, fileUrl, downloadFile } from './api';
import { readDraft, saveDraft } from './draft';
import { canonicalYouTubeUrl } from './shared';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ThemeToggle from './ThemeToggle';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  CircleCheck,
  Clock3,
  Copy,
  ExternalLink,
  Film,
  FolderDown,
  Link2,
  ListVideo,
  LoaderCircle,
  LockKeyhole,
  MonitorPlay,
  Play,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  X as Close,
  Youtube,
} from 'lucide-react';
import {
  PROFILES,
  exportSchema,
  formatBytes,
  formatTime,
  parseTime,
  validateClip,
  isActive,
  type ExportOptions,
  type VideoInfo,
  type Job,
  type Health,
} from './shared';

function readPreferences(): Pick<
  ExportOptions,
  'profile' | 'quality' | 'aspect'
> {
  const defaults = {
    profile: 'standard',
    quality: '720',
    aspect: 'original',
  } as const;
  try {
    return exportSchema
      .pick({ profile: true, quality: true, aspect: true })
      .parse(
        JSON.parse(localStorage.getItem('postready-preferences') || 'null'),
      );
  } catch {
    return defaults;
  }
}

function XLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-7.42L5.57 22H2.45l7.19-8.22L1.8 2h6.4l4.42 6.77L18.9 2Zm-1.1 18h1.73L7.26 3.88H5.4L17.8 20Z" />
    </svg>
  );
}

function App() {
  const [draft] = useState(readDraft);
  const [incoming, setIncoming] = useState('');
  const [view, setView] = useState<'create' | 'downloads'>(draft.view);
  const [url, setUrl] = useState(draft.url);
  const [video, setVideo] = useState<VideoInfo | null>(draft.video);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preferences, setPreferences] = useState(readPreferences);
  const [startTime, setStartTime] = useState(draft.startTime);
  const [endTime, setEndTime] = useState(draft.endTime);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(draft.jobId);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const guideRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentJob = jobs.find((job) => job.id === jobId);
  const processing = Boolean(currentJob && isActive(currentJob));
  const completed = jobs.filter((job) => job.status === 'completed');
  const options: ExportOptions = {
    ...preferences,
    videoToken: video?.token || '',
    start: parseTime(startTime),
    end: parseTime(endTime),
  };
  const clipError = video
    ? !Number.isFinite(options.start) || !Number.isFinite(options.end)
      ? 'Enter a time such as 1:30 or 0:05.'
      : validateClip(options, video)
    : null;
  const clipDuration = Number.isFinite(options.end - options.start)
    ? Math.max(0, options.end - options.start)
    : 0;
  const actualQuality =
    preferences.profile === 'premium' && clipDuration > 7200
      ? '720'
      : preferences.quality;

  useEffect(() => {
    saveDraft({ url, video, startTime, endTime, jobId, view });
  }, [url, video, startTime, endTime, jobId, view]);

  useEffect(() => {
    const receive = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') return;
      try { setIncoming(canonicalYouTubeUrl(value.url)); } catch { /* Ignore invalid stored links. */ }
    };
    const query = new URLSearchParams(window.location.search).get('url');
    if (query) receive({ url: query });
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    void chrome.storage.local.get('pendingVideo').then(result => receive(result.pendingVideo)).catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.pendingVideo?.newValue) receive(changes.pendingVideo.newValue);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);

  async function useIncoming() {
    if (processing || starting || loading) return;
    setUrl(incoming);
    setVideo(null);
    setJobId(null);
    setView('create');
    setError('');
    setIncoming('');
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove('pendingVideo').catch(() => {});
    }
    window.history.replaceState(null, '', window.location.pathname);
    inputRef.current?.focus();
  }

  async function saveFile(id: string) {
    setBusyId(id);
    try {
      await downloadFile(id);
      setNotice('Save dialog opened. Chrome will show the download progress.');
    } catch (error) {
      setError(`Couldn’t save the MP4. ${(error as Error).message}`);
    } finally { setBusyId(null); }
  }

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await api<Job[]>('/api/jobs');
        if (stopped) return;
        setJobs(result);
        setConnected(true);
        timer = setTimeout(refresh, result.some(isActive) ? 1500 : 5000);
      } catch {
        if (!stopped) {
          setConnected(false);
          timer = setTimeout(refresh, 5000);
        }
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const refresh = () =>
      api<Health>('/api/health')
        .then((value) => {
          if (!stopped) setHealth(value);
        })
        .catch(() => {
          if (!stopped) setHealth(null);
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        'postready-preferences',
        JSON.stringify(preferences),
      );
    } catch {
      /* Preferences still work in memory. */
    }
  }, [preferences]);
  useEffect(() => {
    const dialog = guideRef.current;
    if (showGuide && dialog && !dialog.open) dialog.showModal();
    if (!showGuide && dialog?.open) dialog.close();
  }, [showGuide]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function analyze(event?: React.FormEvent) {
    event?.preventDefault();
    if (!url.trim() || loading || processing) return;
    setError('');
    setLoading(true);
    setJobId(null);
    try {
      const result = await api<VideoInfo>('/api/inspect', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setVideo(result);
      setUrl(result.url);
      setStartTime('0:00');
      setEndTime(
        formatTime(
          Math.min(
            Math.floor(result.duration),
            PROFILES[preferences.profile].maxDuration,
          ),
        ),
      );
    } catch (error) {
      setVideo(null);
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function paste() {
    try {
      setUrl(await navigator.clipboard.readText());
      setError('');
      inputRef.current?.focus();
    } catch {
      setNotice(
        'Clipboard access isn’t available. Paste your link into the field with ⌘V or Ctrl+V.',
      );
      inputRef.current?.focus();
    }
  }

  async function startExport() {
    if (!video || clipError || starting || processing) return;
    setError('');
    setStarting(true);
    try {
      const job = await api<Job>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(options),
      });
      setJobs((previous) => [job, ...previous]);
      setJobId(job.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob(id: string) {
    setBusyId(id);
    try {
      await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
      setJobs(await api<Job[]>('/api/jobs'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteJob(id: string) {
    setBusyId(id);
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      setJobs((previous) => previous.filter((job) => job.id !== id));
      if (jobId === id) setJobId(null);
      setNotice('Export removed from your local library.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function reset() {
    setView('create');
    setVideo(null);
    setJobId(null);
    setUrl('');
    setError('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="./index.html" aria-label="PostReady home">
          <span className="brand-mark">
            <Play size={19} fill="currentColor" strokeWidth={0} />
          </span>
          <span>
            PostReady<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="nav-label">
          YOUR STUDIO <span>01</span>
        </span>
        <nav aria-label="Main navigation">
          <motion.button
            whileTap={{ scale: 0.97 }}
            aria-label="Video downloader"
            aria-current={view === 'create' ? 'page' : undefined}
            className={`nav-item ${view === 'create' ? 'active' : ''}`}
            onClick={() => {
              setView('create');
              setError('');
            }}
          >
            {view === 'create' && (
              <motion.span className="nav-selection" layoutId="nav-selection" />
            )}
            <MonitorPlay size={18} />
            <span>Video downloader</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            aria-label="My downloads"
            aria-current={view === 'downloads' ? 'page' : undefined}
            className={`nav-item ${view === 'downloads' ? 'active' : ''}`}
            onClick={() => {
              setView('downloads');
              setError('');
            }}
          >
            {view === 'downloads' && (
              <motion.span className="nav-selection" layoutId="nav-selection" />
            )}
            <FolderDown size={18} />
            <span>My downloads</span>
            <span className="nav-count">{completed.length}</span>
          </motion.button>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <XLogo />
          </div>
          <span className="note-kicker">LESS FRICTION. MORE CREATING.</span>
          <h3>
            Good moments deserve
            <br />a bigger audience.
          </h3>
          <p>
            From a YouTube link to your next great post. We’ll handle the
            details.
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowGuide(true)}
          >
            See how it works <ArrowRight size={14} />
          </motion.button>
        </div>
        <div className="sidebar-bottom">
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="nav-item"
            aria-label="Help and upload guide"
            onClick={() => setShowGuide(true)}
          >
            <CircleHelp size={18} />
            <span>Help & upload guide</span>
            <ExternalLink size={13} />
          </motion.button>
          <div className="local-account">
            <span className="avatar">
              P<small />
            </span>
            <div>
              <strong>Your workspace</strong>
              <span>Local & private</span>
            </div>
            <LockKeyhole size={14} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span>
            <strong>
              {view === 'create' ? 'Video downloader' : 'My downloads'}
            </strong>
          </div>
          <div className="topbar-actions">
            <div
              className={`engine-status ${connected && health?.ready ? 'online' : 'offline'}`}
            >
              <span className="status-dot" />
              {connected && health?.ready
                ? 'Ready to process'
                : !connected
                  ? 'Companion offline'
                  : 'Setup required'}
            </div>
            <span className="topbar-divider" />
            <ThemeToggle />
          </div>
        </header>
        <main id="workspace" tabIndex={-1}>
          <motion.div
            className="page-heading"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div>
              <div className="eyebrow">
                <span /> A SMALL TOOL FOR YOUR BIG IDEAS
              </div>
              <h1>
                {view === 'create' ? (
                  <>
                    Find a moment.
                    <br />
                    <span>Make it a post.</span>
                  </>
                ) : (
                  <>
                    Good moments.
                    <br />
                    <span>Yours to share.</span>
                  </>
                )}
              </h1>
              <p>
                {view === 'create'
                  ? 'YouTube to your timeline, beautifully simple. Pick a clip. Choose your format. We’ll take care of the rest.'
                  : 'Your recent exports, checked and ready for your next post.'}
              </p>
            </div>
            <div className="platform-flow" aria-hidden="true">
              <span className="flow-caption">A SHORTER WAY TO SHARE</span>
              <span className="youtube-tile">
                <Youtube size={29} fill="currentColor" stroke="white" />
              </span>
              <span className="flow-dashes">
                ···
                <ArrowRight size={16} />
                ···
              </span>
              <span className="x-tile">
                <XLogo />
              </span>
            </div>
          </motion.div>

          <div className="workspace-tabs">
            <div
              className="workspace-view-buttons"
              role="group"
              aria-label="Workspace views"
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                aria-pressed={view === 'create'}
                className={view === 'create' ? 'selected' : ''}
                onClick={() => {
                  setView('create');
                  setError('');
                }}
              >
                {view === 'create' && (
                  <motion.span
                    className="tab-indicator"
                    layoutId="workspace-tab"
                  />
                )}
                <Plus size={16} />
                Create a video
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                aria-pressed={view === 'downloads'}
                className={view === 'downloads' ? 'selected' : ''}
                onClick={() => {
                  setView('downloads');
                  setError('');
                }}
              >
                {view === 'downloads' && (
                  <motion.span
                    className="tab-indicator"
                    layoutId="workspace-tab"
                  />
                )}
                <ListVideo size={16} />
                My downloads<span>{completed.length}</span>
              </motion.button>
            </div>
            <span className="workspace-badge">
              <LockKeyhole size={12} /> LOCAL WORKSPACE
            </span>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="alert error"
                role="alert"
              >
                <TriangleAlert size={18} />
                <span>{error}</span>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <Close size={16} />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
          {incoming && <div className="incoming-link" role="status">
            <Youtube size={19}/><div><strong>A video from your toolbar is ready.</strong><p>{incoming}</p></div>
            <button className="secondary" disabled={processing || starting || loading} onClick={() => void useIncoming()}>Use this link <ArrowRight size={15}/></button>
          </div>}
          {!connected && <section className="companion-guide" aria-label="Local companion setup">
            <div><LockKeyhole size={19}/><h2>Connect your local companion</h2></div>
            <p>In this extension’s project folder, run <code>npm start</code> and keep it running. PostReady reconnects automatically. First time? Run <code>npm install</code> and <code>npm run setup</code> first.</p>
            <span>Processing continues when you close this tab. Keep the companion running until your MP4 is saved.</span>
          </section>}
          {connected && health && !health.ready && (
            <div className="alert warning">
              <TriangleAlert size={18} />
              <span>
                Finish local setup to enable downloads. Run{' '}
                <code>npm run setup</code> in this project, then restart the
                companion.
              </span>
            </div>
          )}

          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {view === 'create' ? (
              <>
                <section
                  className="card link-card"
                  aria-labelledby="link-heading"
                >
                  <div className="section-title">
                    <span className="step-number">01</span>
                    <h2 id="link-heading">Add your YouTube link</h2>
                    <span className="subtle-pill">
                      <Youtube size={12} /> Videos & Shorts
                    </span>
                  </div>
                  <form className="url-form" onSubmit={analyze}>
                    <div className="url-input">
                      <Link2 size={19} />
                      <input
                        ref={inputRef}
                        aria-label="YouTube video link"
                        type="url"
                        placeholder="Paste a YouTube video link here…"
                        value={url}
                        disabled={loading || processing}
                        onChange={(event) => {
                          setUrl(event.target.value);
                          setError('');
                        }}
                        required
                      />
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        className="paste-button"
                        type="button"
                        disabled={loading || processing}
                        onClick={() => void paste()}
                      >
                        <Copy size={13} />
                        Paste
                      </motion.button>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="primary analyze-button"
                      type="submit"
                      disabled={
                        !url.trim() || loading || processing || !health?.ready
                      }
                    >
                      {loading ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : null}
                      {loading ? 'Loading video' : 'Get video'}
                      {!loading && <ArrowRight size={17} />}
                    </motion.button>
                  </form>
                  <p className="input-hint">
                    <Youtube size={14} />
                    Works with youtube.com, youtu.be, and YouTube Shorts links.
                  </p>
                </section>

                <div className="editor-grid">
                  <div className="editor-column">
                    <section
                      className="card preview-card"
                      aria-labelledby="preview-heading"
                    >
                      <div className="section-title">
                        <span className="step-number">02</span>
                        <h2 id="preview-heading">Preview & trim</h2>
                        <span className="muted">
                          {video
                            ? formatTime(video.duration) + ' source'
                            : 'Choose your moment'}
                        </span>
                      </div>
                      <motion.div
                        key={loading ? 'loading' : video?.token || 'empty'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.22 }}
                      >
                        {loading ? (
                          <div className="empty-preview loading-preview">
                            <LoaderCircle className="spin" size={32} />
                            <h3>Finding your video…</h3>
                            <p>
                              Fetching the title, duration, and available
                              formats.
                            </p>
                          </div>
                        ) : !video ? (
                          <div className="empty-preview">
                            <motion.div
                              className="empty-art"
                              aria-hidden="true"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.5, delay: 0.08 }}
                            >
                              <span className="art-line line-one" />
                              <span className="art-line line-two" />
                              <div className="art-video">
                                <div className="art-video-dots">
                                  <i />
                                  <i />
                                  <i />
                                </div>
                                <span className="art-play">
                                  <Play size={23} fill="currentColor" />
                                </span>
                                <div className="art-timeline">
                                  <span />
                                  <i />
                                </div>
                              </div>
                              <span className="art-check">
                                <Check size={17} />
                              </span>
                            </motion.div>
                            <h3>Your next great post starts here.</h3>
                            <p>
                              Add a video above to preview it and pick
                              <br className="desktop-break" /> the perfect clip
                              for your audience.
                            </p>
                            <span className="empty-label">
                              <Film size={13} /> Your video will appear here
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="video-preview">
                              {currentJob?.status === 'completed' ? (
                                <video
                                  key={currentJob.id}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  src={fileUrl(currentJob.id, true)}
                                  poster={video.thumbnail}
                                />
                              ) : (
                                <>
                                  <img
                                    src={video.thumbnail}
                                    alt={`Thumbnail for ${video.title}`}
                                  />
                                  <a
                                    className="source-play"
                                    href={video.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Watch source video on YouTube"
                                  >
                                    <Play size={23} fill="currentColor" />
                                  </a>
                                  <span className="preview-duration">
                                    {formatTime(video.duration)}
                                  </span>
                                  <span className="source-label">
                                    SOURCE PREVIEW
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="video-details">
                              <h3>{video.title}</h3>
                              <div>
                                <span>
                                  <Youtube size={14} />
                                  {video.channel}
                                </span>
                                <a
                                  href={video.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View on YouTube
                                  <ExternalLink size={12} />
                                </a>
                              </div>
                            </div>
                            <div className="trim-editor">
                              <div className="trim-heading">
                                <label>
                                  <Scissors size={15} />
                                  Select your clip
                                </label>
                                <span>{formatTime(clipDuration)} selected</span>
                              </div>
                              <div className="clip-timeline" aria-hidden="true">
                                <div
                                  className="clip-selection"
                                  style={{
                                    left: `${Math.min(100, Math.max(0, (options.start / video.duration) * 100 || 0))}%`,
                                    width: `${Math.min(100, (clipDuration / video.duration) * 100)}%`,
                                  }}
                                >
                                  <i />
                                  <i />
                                </div>
                              </div>
                              <div className="timeline-labels">
                                <span>0:00</span>
                                <span>{formatTime(video.duration)}</span>
                              </div>
                              <div className="trim-fields">
                                <label>
                                  Start time
                                  <div>
                                    <Clock3 size={14} />
                                    <input
                                      aria-label="Clip start time"
                                      value={startTime}
                                      onChange={(event) =>
                                        setStartTime(event.target.value)
                                      }
                                      disabled={processing || starting}
                                    />
                                  </div>
                                </label>
                                <ArrowRight size={16} />
                                <label>
                                  End time
                                  <div>
                                    <Clock3 size={14} />
                                    <input
                                      aria-label="Clip end time"
                                      value={endTime}
                                      onChange={(event) =>
                                        setEndTime(event.target.value)
                                      }
                                      disabled={processing || starting}
                                    />
                                  </div>
                                </label>
                                <motion.button
                                  whileTap={{ scale: 0.97 }}
                                  disabled={processing || starting}
                                  className="text-button"
                                  onClick={() => {
                                    setStartTime('0:00');
                                    setEndTime(
                                      formatTime(
                                        Math.min(
                                          Math.floor(video.duration),
                                          PROFILES[preferences.profile]
                                            .maxDuration,
                                        ),
                                      ),
                                    );
                                  }}
                                >
                                  Reset clip
                                </motion.button>
                              </div>
                              {clipError ? (
                                <p className="clip-error">
                                  <TriangleAlert size={14} />
                                  {clipError}
                                </p>
                              ) : (
                                <p className="trim-help">
                                  {video.duration >
                                  PROFILES[preferences.profile].maxDuration
                                    ? `The first ${formatTime(PROFILES[preferences.profile].maxDuration)} is selected. Adjust the times to choose a different moment.`
                                    : 'Your full video is selected. Adjust the times to keep just the part you want.'}
                                </p>
                              )}
                            </div>
                          </>
                        )}
                      </motion.div>
                    </section>

                    {currentJob && (
                      <motion.section
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`card job-card ${currentJob.status}`}
                        aria-live="polite"
                      >
                        <div className="job-heading">
                          <span className="job-icon">
                            {currentJob.status === 'completed' ? (
                              <CheckCheck size={21} />
                            ) : isActive(currentJob) ? (
                              <LoaderCircle className="spin" size={21} />
                            ) : (
                              <TriangleAlert size={20} />
                            )}
                          </span>
                          <div>
                            <h3>
                              {currentJob.status === 'completed'
                                ? 'Your video is ready for X.'
                                : currentJob.status === 'failed'
                                  ? 'We couldn’t finish this export.'
                                  : currentJob.status === 'cancelled'
                                    ? 'Export cancelled.'
                                    : 'Preparing your next post…'}
                            </h3>
                            <p>{currentJob.message}</p>
                          </div>
                          {isActive(currentJob) && (
                            <motion.button
                              whileTap={{ scale: 0.97 }}
                              className="text-button"
                              disabled={busyId === currentJob.id}
                              onClick={() => void cancelJob(currentJob.id)}
                            >
                              Cancel
                            </motion.button>
                          )}
                        </div>
                        {isActive(currentJob) && (
                          <>
                            <div
                              className="progress-track"
                              role="progressbar"
                              aria-label="Export progress"
                              aria-valuenow={currentJob.progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <motion.span
                                initial={{ width: 0 }}
                                animate={{ width: `${currentJob.progress}%` }}
                              />
                            </div>
                            <div className="progress-stages">
                              <span
                                className={
                                  currentJob.status === 'downloading'
                                    ? 'current'
                                    : ''
                                }
                              >
                                Downloading
                              </span>
                              <span
                                className={
                                  currentJob.status === 'converting'
                                    ? 'current'
                                    : ''
                                }
                              >
                                Converting
                              </span>
                              <span
                                className={
                                  currentJob.status === 'verifying'
                                    ? 'current'
                                    : ''
                                }
                              >
                                Checking
                              </span>
                              <strong>{currentJob.progress}%</strong>
                            </div>
                          </>
                        )}
                        {currentJob.status === 'completed' &&
                          currentJob.result && (
                            <>
                              <div className="result-specs">
                                <span>
                                  {formatTime(currentJob.result.duration)}
                                </span>
                                <span>
                                  {formatBytes(currentJob.result.size)}
                                </span>
                                <span>
                                  {currentJob.result.width} ×{' '}
                                  {currentJob.result.height}
                                </span>
                                <span>MP4 · H.264 · AAC</span>
                              </div>
                              <div className="result-actions">
                                <button
                                  className="primary"
                                  onClick={() => void saveFile(currentJob.id)}
                                  disabled={busyId === currentJob.id}
                                >
                                  <ArrowDownToLine size={17} />
                                  Download MP4
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.97 }}
                                  className="secondary"
                                  onClick={reset}
                                >
                                  Create another
                                </motion.button>
                              </div>
                              <p className="verified-note">
                                <ShieldCheck size={14} />
                                {currentJob.result.checks.length} compatibility
                                checks passed
                              </p>
                            </>
                          )}
                        {(currentJob.status === 'failed' ||
                          currentJob.status === 'cancelled') && (
                          <motion.button
                            whileTap={{ scale: 0.97 }}
                            className="secondary retry-button"
                            disabled={starting || Boolean(clipError)}
                            onClick={() => void startExport()}
                          >
                            Try again
                            <ArrowRight size={15} />
                          </motion.button>
                        )}
                      </motion.section>
                    )}

                    <div className="privacy-note">
                      <LockKeyhole size={14} />
                      <span>
                        Processed on your computer. Your videos stay yours.
                      </span>
                    </div>
                  </div>

                  <aside className="export-column">
                    <section
                      className="card export-card"
                      aria-labelledby="export-heading"
                    >
                      <div className="section-title">
                        <span className="step-number">03</span>
                        <h2 id="export-heading">Export settings</h2>
                        <span className="settings-label">MAKE IT YOURS</span>
                      </div>
                      <div className="export-controls">
                        <label className="field-label" htmlFor="profile">
                          Upload preset
                        </label>
                        <div className="select-wrap">
                          <XLogo />
                          <select
                            id="profile"
                            value={preferences.profile}
                            disabled={processing || starting}
                            onChange={(event) =>
                              setPreferences((previous) => ({
                                ...previous,
                                profile: event.target
                                  .value as ExportOptions['profile'],
                              }))
                            }
                          >
                            <option value="standard">X Standard</option>
                            <option value="premium">
                              X Premium · web / iOS
                            </option>
                          </select>
                          <ChevronDown size={14} />
                        </div>
                        <p className="field-help">
                          {PROFILES[preferences.profile].description}
                        </p>
                        <div className="quality-label">
                          <span className="field-label">Video quality</span>
                          <span>30 fps</span>
                        </div>
                        <div className="quality-picker">
                          {(['720', '1080'] as const).map((quality) => (
                            <motion.button
                              whileTap={{ scale: 0.97 }}
                              key={quality}
                              aria-pressed={preferences.quality === quality}
                              disabled={processing || starting}
                              className={
                                preferences.quality === quality ? 'chosen' : ''
                              }
                              onClick={() =>
                                setPreferences((previous) => ({
                                  ...previous,
                                  quality,
                                }))
                              }
                            >
                              <strong>{quality}p</strong>
                              <span>
                                {quality === '720'
                                  ? 'Recommended'
                                  : 'Higher detail'}
                              </span>
                              {preferences.quality === quality && (
                                <CircleCheck size={14} />
                              )}
                            </motion.button>
                          ))}
                        </div>
                        {actualQuality !== preferences.quality && (
                          <p className="field-help">
                            Clips over 2 hours are exported at 720p for X
                            Premium.
                          </p>
                        )}
                        <span className="field-label aspect-label">
                          Frame shape
                        </span>
                        <div className="aspect-picker">
                          {(
                            [
                              {
                                value: 'original',
                                label: 'Original',
                                className: 'shape-original',
                              },
                              {
                                value: 'landscape',
                                label: '16:9',
                                className: 'shape-landscape',
                              },
                              {
                                value: 'square',
                                label: '1:1',
                                className: 'shape-square',
                              },
                              {
                                value: 'portrait',
                                label: '9:16',
                                className: 'shape-portrait',
                              },
                            ] as const
                          ).map((aspect) => (
                            <motion.button
                              whileTap={{ scale: 0.97 }}
                              key={aspect.value}
                              aria-pressed={preferences.aspect === aspect.value}
                              disabled={processing || starting}
                              className={
                                preferences.aspect === aspect.value
                                  ? 'chosen'
                                  : ''
                              }
                              onClick={() =>
                                setPreferences((previous) => ({
                                  ...previous,
                                  aspect: aspect.value,
                                }))
                              }
                            >
                              <span className={aspect.className} />
                              {aspect.label}
                            </motion.button>
                          ))}
                        </div>
                        <p className="field-help">
                          {preferences.aspect === 'original'
                            ? 'Keep the source’s shape. No cropping.'
                            : 'Fit the entire video. Padding fills extra space.'}
                        </p>
                      </div>
                      <div className="compatibility-box">
                        <div className="compatibility-heading">
                          <ShieldCheck size={16} />
                          <strong>Built for X</strong>
                          <span>Auto-optimized</span>
                        </div>
                        <dl>
                          <div>
                            <dt>File format</dt>
                            <dd>
                              MP4 <Check size={12} />
                            </dd>
                          </div>
                          <div>
                            <dt>Video / audio</dt>
                            <dd>
                              H.264 / AAC <Check size={12} />
                            </dd>
                          </div>
                          <div>
                            <dt>Max. duration</dt>
                            <dd>
                              {preferences.profile === 'standard'
                                ? '2 min 20 sec'
                                : 'Under 4 hours'}{' '}
                              <Check size={12} />
                            </dd>
                          </div>
                          <div>
                            <dt>Max. file size</dt>
                            <dd>
                              {preferences.profile === 'standard'
                                ? '512 MB'
                                : '16 GB'}{' '}
                              <Check size={12} />
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="export-bottom">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          className="primary export-button"
                          onClick={() => void startExport()}
                          disabled={
                            !video ||
                            Boolean(clipError) ||
                            processing ||
                            starting ||
                            !connected ||
                            !health?.ready
                          }
                        >
                          {starting || processing ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : (
                            <ArrowDownToLine size={17} />
                          )}
                          {starting
                            ? 'Starting export…'
                            : processing
                              ? 'Preparing video…'
                              : 'Prepare for X'}
                          {!starting && !processing && <ArrowRight size={16} />}
                        </motion.button>
                        <p>
                          {video
                            ? 'We’ll verify your MP4 before you download.'
                            : 'Add a video link to get started.'}
                        </p>
                      </div>
                    </section>
                    <div className="tip-card">
                      <span>
                        <Sparkles size={16} />
                      </span>
                      <div>
                        <strong>A little shorter. A lot stronger.</strong>
                        <p>
                          A focused clip makes a great post. Keep the moment
                          that matters.
                        </p>
                      </div>
                    </div>
                  </aside>
                </div>

                <section className="how-strip" aria-label="How PostReady works">
                  <div>
                    <span className="how-icon">
                      <Link2 size={19} />
                    </span>
                    <div>
                      <h3>Paste a link</h3>
                      <p>Bring a video from YouTube.</p>
                    </div>
                  </div>
                  <ArrowRight className="how-arrow" size={16} />
                  <div>
                    <span className="how-icon">
                      <Scissors size={19} />
                    </span>
                    <div>
                      <h3>Make it yours</h3>
                      <p>Choose your clip and frame.</p>
                    </div>
                  </div>
                  <ArrowRight className="how-arrow" size={16} />
                  <div>
                    <span className="how-icon">
                      <XLogo />
                    </span>
                    <div>
                      <h3>Take it to your timeline</h3>
                      <p>Download. Upload. Hit post.</p>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <section className="downloads-section">
                <div className="downloads-heading">
                  <div>
                    <h2>
                      Your local library <span>{jobs.length}</span>
                    </h2>
                    <p>Files are automatically removed after 24 hours.</p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    className="primary"
                    onClick={reset}
                  >
                    <Plus size={16} />
                    New video
                  </motion.button>
                </div>
                {!jobs.length ? (
                  <div className="card downloads-empty">
                    <span>
                      <FolderDown size={31} />
                    </span>
                    <h3>A home for your next great post.</h3>
                    <p>
                      Your prepared videos will appear here.
                      <br />
                      Start with a YouTube link to create your first export.
                    </p>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="secondary"
                      onClick={reset}
                    >
                      Create a video
                      <ArrowRight size={16} />
                    </motion.button>
                  </div>
                ) : (
                  <div className="download-list">
                    <AnimatePresence initial={false}>
                      {jobs.map((job) => (
                        <motion.article
                          layout="position"
                          exit={{ opacity: 0, scale: 0.98 }}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="card download-row"
                          key={job.id}
                        >
                          <img
                            className="download-thumbnail"
                            src={job.video.thumbnail}
                            alt=""
                          />
                          <div className="download-info">
                            <h3>{job.video.title}</h3>
                            <p>
                              {job.video.channel}
                              <span>·</span>
                              {new Date(job.createdAt).toLocaleString(
                                undefined,
                                {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                },
                              )}
                            </p>
                            <div className="download-meta">
                              <span className={`job-status ${job.status}`}>
                                {job.status === 'completed' ? (
                                  <CircleCheck size={12} />
                                ) : isActive(job) ? (
                                  <LoaderCircle size={12} className="spin" />
                                ) : (
                                  <TriangleAlert size={12} />
                                )}
                                {job.status === 'completed'
                                  ? 'Ready for X'
                                  : job.status.charAt(0).toUpperCase() +
                                    job.status.slice(1)}
                              </span>
                              {job.result ? (
                                <span>
                                  {formatBytes(job.result.size)}
                                  <i>·</i>
                                  {formatTime(job.result.duration)}
                                  <i>·</i>MP4
                                </span>
                              ) : isActive(job) ? (
                                <span>{job.progress}%</span>
                              ) : (
                                <span className="download-error">
                                  {job.error || job.message}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="download-actions">
                            {job.status === 'completed' && (
                              <button
                                className="secondary"
                                onClick={() => void saveFile(job.id)}
                                disabled={busyId === job.id}
                              >
                                <ArrowDownToLine size={16} />
                                Download
                              </button>
                            )}
                            {isActive(job) ? (
                              <motion.button
                                whileTap={{ scale: 0.97 }}
                                className="secondary"
                                disabled={busyId === job.id}
                                onClick={() => void cancelJob(job.id)}
                              >
                                Cancel
                              </motion.button>
                            ) : (
                              <motion.button
                                whileTap={{ scale: 0.97 }}
                                className="icon-button"
                                aria-label={`Delete export: ${job.video.title}`}
                                disabled={busyId === job.id}
                                onClick={() => void deleteJob(job.id)}
                              >
                                <Trash2 size={17} />
                              </motion.button>
                            )}
                          </div>
                        </motion.article>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </section>
            )}
          </motion.div>

          <footer>
            <span>Made for the moment you want to share.</span>
            <div>
              <span>
                Only download content you own or have permission to use.
              </span>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowGuide(true)}
              >
                Upload guide
                <ExternalLink size={12} />
              </motion.button>
            </div>
          </footer>
        </main>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="toast"
            role="status"
          >
            <CircleCheck size={17} />
            <span>{notice}</span>
            <motion.button
              whileTap={{ scale: 0.97 }}
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <Close size={14} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      <dialog
        className="guide-dialog"
        ref={guideRef}
        onClose={() => setShowGuide(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShowGuide(false);
        }}
        aria-labelledby="guide-title"
      >
        <motion.div
          className="guide-content"
          initial={false}
          animate={{ opacity: showGuide ? 1 : 0, scale: showGuide ? 1 : 0.97 }}
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="dialog-close icon-button"
            aria-label="Close guide"
            onClick={() => setShowGuide(false)}
          >
            <Close size={20} />
          </motion.button>
          <span className="guide-icon">
            <XLogo />
          </span>
          <h2 id="guide-title">From link to timeline.</h2>
          <p className="guide-intro">
            A few simple steps to make your next post ready.
          </p>
          <ol>
            <li>
              <strong>Load a public YouTube video.</strong>
              <p>
                Paste a watch, Shorts, or youtu.be link. Private, live, and
                restricted videos may not be available.
              </p>
            </li>
            <li>
              <strong>Pick the part you want to share.</strong>
              <p>
                Use start and end times in m:ss or h:mm:ss. Standard keeps clips
                within 2:20 and 512 MB. Premium allows longer clips for web and
                iOS uploads.
              </p>
            </li>
            <li>
              <strong>Prepare and download your MP4.</strong>
              <p>
                PostReady downloads your section, converts to H.264 and AAC, and
                verifies upload limits and playback. Conversion can take a few
                minutes.
              </p>
            </li>
            <li>
              <strong>Upload it to X.</strong>
              <p>
                Open X, create a post, choose your downloaded MP4 with the media
                button, and publish when you’re ready.
              </p>
            </li>
          </ol>
          <div className="guide-note">
            <ShieldCheck size={18} />
            <p>
              Our presets follow X’s published web upload limits. Account
              eligibility, content restrictions, and platform changes can still
              affect uploads. Files stay on this computer and expire after 24
              hours.
            </p>
          </div>
          <a
            className="secondary"
            href="https://help.x.com/en/using-x/x-videos"
            target="_blank"
            rel="noreferrer"
          >
            X’s official upload requirements
            <ExternalLink size={14} />
          </a>
        </motion.div>
      </dialog>
    </div>
  );
}

export default App;
