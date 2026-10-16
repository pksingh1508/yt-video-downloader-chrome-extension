import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Film,
  FolderDown,
  Link2,
  LoaderCircle,
  Play,
  Plus,
  Scissors,
  ShieldCheck,
  Trash2,
  Youtube,
} from 'lucide-react';
import { fileUrl } from './api';
import { usePopup } from './usePopup';
import ThemeToggle from './ThemeToggle';
import {
  canonicalYouTubeUrl,
  formatBytes,
  formatTime,
  isActive,
} from './shared';
import '@fontsource-variable/geist';
import './popup.css';

export function Popup() {
  const state = usePopup();
  const {
    draft,
    setDraft,
    preferences,
    setPreferences,
    health,
    checked,
    connected,
    jobs,
    loading,
    starting,
    busyId,
    error,
    notice,
    currentJob,
    processing,
    options,
    clipError,
  } = state;
  const [guide, setGuide] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const locked = processing || starting || loading || !checked;
  let valid = false;
  try {
    canonicalYouTubeUrl(draft.url);
    valid = true;
  } catch {
    /* Disable submission until a valid link is entered. */
  }
  const ready = connected && health?.ready;
  const duration = Number.isFinite(options.end - options.start)
    ? Math.max(0, options.end - options.start)
    : 0;
  const completed = currentJob?.status === 'completed';

  return (
    <main className="popup">
      <header className="popup-header">
        <span className="popup-brand">
          <i>
            <Play size={16} fill="currentColor" />
          </i>
          PostReady<span>.</span>
        </span>
        <ThemeToggle />
      </header>
      <div className={`connection ${ready ? 'ready' : ''}`} role="status">
        <span />
        {!checked
          ? 'Checking companion…'
          : ready
            ? 'Local companion connected'
            : health
              ? 'Processing tools need setup'
              : 'Local companion is offline'}
        <button
          aria-label="Companion setup instructions"
          aria-expanded={guide}
          onClick={() => setGuide(!guide)}
        >
          <CircleHelp size={15} />
        </button>
      </div>
      <nav className="popup-tabs" aria-label="Popup views">
        <button
          aria-pressed={draft.view === 'create'}
          onClick={() =>
            setDraft((previous) => ({ ...previous, view: 'create' }))
          }
        >
          <Scissors size={14} />
          Create a video
        </button>
        <button
          aria-label="My downloads"
          aria-pressed={draft.view === 'downloads'}
          onClick={() =>
            setDraft((previous) => ({ ...previous, view: 'downloads' }))
          }
        >
          <FolderDown size={14} />
          My downloads<span>{jobs.length}</span>
        </button>
      </nav>
      <div className="popup-content">
        {(guide || (checked && !ready)) && (
          <aside className="setup">
            <strong>
              {health
                ? 'Finish processing setup'
                : 'Start your local companion'}
            </strong>
            <p>In the extension project folder, run:</p>
            <code>{health ? 'npm run setup' : 'npm start'}</code>
            <p>
              {health
                ? 'Restart the companion after setup.'
                : 'Keep it running while preparing and saving videos.'}{' '}
              Your videos are processed on this computer.
            </p>
          </aside>
        )}
        {error && (
          <p className="popup-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="popup-notice" role="status">
            {notice}
          </p>
        )}
        {draft.view === 'downloads' ? (
          <section aria-label="Download history">
            <div className="section-heading">
              <div>
                <h1>Your downloads</h1>
                <p>Local exports expire after 24 hours.</p>
              </div>
              <button
                className="subtle-button"
                disabled={starting || loading}
                onClick={state.reset}
              >
                <Plus size={14} />
                New video
              </button>
            </div>
            {!jobs.length ? (
              <div className="empty-library">
                <FolderDown size={28} />
                <h2>No exports yet.</h2>
                <p>Your prepared videos will appear here.</p>
                <button
                  className="subtle-button"
                  onClick={() =>
                    setDraft((previous) => ({ ...previous, view: 'create' }))
                  }
                >
                  Create a video <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <div className="job-list">
                {jobs.map((job) => (
                  <article className="history-job" key={job.id}>
                    <button
                      className="history-title"
                      onClick={() => state.selectJob(job)}
                    >
                      <strong>{job.video.title}</strong>
                      <span>
                        {job.status === 'completed'
                          ? 'Ready for X'
                          : job.status}{' '}
                        · {formatTime(job.options.end - job.options.start)}
                        {job.result
                          ? ` · ${formatBytes(job.result.size)}`
                          : isActive(job)
                            ? ` · ${job.progress}%`
                            : ''}
                      </span>
                    </button>
                    {!isActive(job) && job.status !== 'completed' && (
                      <p>{job.error || job.message}</p>
                    )}
                    <div className="history-actions">
                      <button
                        className="subtle-button"
                        onClick={() => state.selectJob(job)}
                      >
                        {job.status === 'completed' ? 'Preview' : 'View export'}
                      </button>
                      {job.status === 'completed' && (
                        <button
                          className="subtle-button"
                          disabled={busyId === job.id || !ready}
                          onClick={() => void state.saveFile(job.id)}
                        >
                          <ArrowDownToLine size={14} />
                          Download
                        </button>
                      )}
                      {isActive(job) ? (
                        <button
                          className="subtle-button"
                          disabled={busyId === job.id}
                          onClick={() => void state.cancelJob(job.id)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          className="icon-button"
                          aria-label={`Delete export: ${job.video.title}`}
                          disabled={busyId === job.id}
                          onClick={() => void state.deleteJob(job.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {!draft.video && (
              <section className="popup-intro">
                <span className="kicker">YOUTUBE → X</span>
                <h1>
                  A good moment.
                  <br />
                  <span>Ready to share.</span>
                </h1>
                <p>Choose a clip. Get an upload-ready MP4.</p>
              </section>
            )}
            {(!draft.video || showLink) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void state.analyze().then((loaded) => {
                    if (loaded) setShowLink(false);
                  });
                }}
              >
                <label htmlFor="video-link">YouTube video link</label>
                <div className="popup-input">
                  <Link2 size={16} />
                  <input
                    id="video-link"
                    type="url"
                    placeholder="https://youtube.com/watch?v=…"
                    value={draft.url}
                    disabled={locked}
                    onChange={(event) => state.setUrl(event.target.value)}
                    required
                  />
                </div>
                {state.tabUrl && (
                  <button
                    className="use-tab"
                    type="button"
                    disabled={locked}
                    onClick={() => state.setUrl(state.tabUrl)}
                  >
                    <Youtube size={14} />
                    Use current YouTube video
                  </button>
                )}
                <button
                  className="popup-primary"
                  type="submit"
                  disabled={!valid || locked || !ready}
                >
                  {loading ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Film size={16} />
                  )}{' '}
                  {loading ? 'Loading video…' : 'Choose clip & format'}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
            {draft.video && (
              <>
                <div className="section-heading editor-heading">
                  <button
                    className="subtle-button"
                    disabled={locked}
                    onClick={() => setShowLink(!showLink)}
                  >
                    <ArrowLeft size={14} />
                    Change link
                  </button>
                  <span className="kicker">PREVIEW & TRIM</span>
                </div>
                <section className="source-card" aria-label="Video preview">
                  <div className="popup-video">
                    {completed ? (
                      <video
                        key={currentJob.id}
                        src={fileUrl(currentJob.id, true)}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : draft.video.thumbnail ? (
                      <img
                        src={draft.video.thumbnail}
                        alt={`Thumbnail for ${draft.video.title}`}
                      />
                    ) : (
                      <Film size={36} />
                    )}
                    <span>
                      {formatTime(
                        completed && currentJob.result
                          ? currentJob.result.duration
                          : draft.video.duration,
                      )}
                    </span>
                  </div>
                  <div className="source-details">
                    <h2>{draft.video.title}</h2>
                    <p>
                      {draft.video.channel} · {formatTime(draft.video.duration)}{' '}
                      source
                    </p>
                  </div>
                </section>
                {currentJob && (
                  <section
                    className={`export-status ${currentJob.status}`}
                    aria-label="Export status"
                    aria-live="polite"
                  >
                    <div className="section-heading">
                      <strong>
                        {completed
                          ? 'Your video is ready for X.'
                          : isActive(currentJob)
                            ? 'Preparing your video…'
                            : currentJob.status === 'cancelled'
                              ? 'Export cancelled.'
                              : 'Export failed.'}
                      </strong>
                      {isActive(currentJob) && (
                        <button
                          className="subtle-button"
                          disabled={busyId === currentJob.id}
                          onClick={() => void state.cancelJob(currentJob.id)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p>{currentJob.message}</p>
                    {isActive(currentJob) && (
                      <>
                        <progress
                          aria-label="Export progress"
                          max="100"
                          value={currentJob.progress}
                        />
                        <span>
                          {currentJob.progress}% · {currentJob.status}
                        </span>
                      </>
                    )}
                    {completed && currentJob.result && (
                      <>
                        <div className="result-details">
                          <span>{formatBytes(currentJob.result.size)}</span>
                          <span>
                            {currentJob.result.width} ×{' '}
                            {currentJob.result.height}
                          </span>
                          <span>MP4 · H.264 · AAC</span>
                        </div>
                        <details>
                          <summary>
                            <ShieldCheck size={13} />
                            All verification checks passed
                          </summary>
                          <ul>
                            {currentJob.result.checks.map((check) => (
                              <li key={check}>{check}</li>
                            ))}
                          </ul>
                        </details>
                        <button
                          className="popup-primary"
                          disabled={busyId === currentJob.id || !ready}
                          onClick={() => void state.saveFile(currentJob.id)}
                        >
                          <ArrowDownToLine size={16} />
                          Download MP4
                        </button>
                        <button
                          className="subtle-button create-another"
                          onClick={state.reset}
                        >
                          <Plus size={14} />
                          Create another video
                        </button>
                      </>
                    )}
                  </section>
                )}
                {!completed && (
                  <>
                    <fieldset disabled={locked} className="clip-fields">
                      <legend>
                        <Scissors size={14} />
                        Select your clip{' '}
                        <span>{formatTime(duration)} selected</span>
                      </legend>
                      <div className="time-fields">
                        <label htmlFor="clip-start">
                          Start time
                          <div>
                            <Clock3 size={14} />
                            <input
                              id="clip-start"
                              aria-label="Clip start time"
                              value={draft.startTime}
                              onChange={(event) =>
                                setDraft((previous) => ({
                                  ...previous,
                                  startTime: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </label>
                        <ArrowRight size={14} />
                        <label htmlFor="clip-end">
                          End time
                          <div>
                            <Clock3 size={14} />
                            <input
                              id="clip-end"
                              aria-label="Clip end time"
                              value={draft.endTime}
                              onChange={(event) =>
                                setDraft((previous) => ({
                                  ...previous,
                                  endTime: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </label>
                      </div>
                      {clipError && (
                        <p className="clip-error" role="alert">
                          {clipError}
                        </p>
                      )}
                    </fieldset>
                    <fieldset disabled={locked} className="format-fields">
                      <legend>Export settings</legend>
                      <label htmlFor="profile">Upload preset</label>
                      <select
                        id="profile"
                        value={preferences.profile}
                        onChange={(event) =>
                          setPreferences((previous) => ({
                            ...previous,
                            profile: event.target
                              .value as typeof preferences.profile,
                          }))
                        }
                      >
                        <option value="standard">
                          X Standard · 2:20 / 512 MB
                        </option>
                        <option value="premium">
                          X Premium · under 4h / 16 GB
                        </option>
                      </select>
                      <label>
                        Video quality <span>30 fps</span>
                      </label>
                      <div className="segmented quality-picker">
                        {(['720', '1080'] as const).map((quality) => (
                          <button
                            key={quality}
                            aria-pressed={preferences.quality === quality}
                            onClick={() =>
                              setPreferences((previous) => ({
                                ...previous,
                                quality,
                              }))
                            }
                          >
                            {quality}p
                            {preferences.quality === quality && (
                              <Check size={12} />
                            )}
                          </button>
                        ))}
                      </div>
                      {preferences.profile === 'premium' && duration > 7200 && (
                        <p className="field-help">
                          Clips over 2 hours export at 720p.
                        </p>
                      )}
                      <label>Frame shape</label>
                      <div className="segmented aspect-picker">
                        {(
                          [
                            { value: 'original', label: 'Original' },
                            { value: 'landscape', label: '16:9' },
                            { value: 'square', label: '1:1' },
                            { value: 'portrait', label: '9:16' },
                          ] as const
                        ).map((aspect) => (
                          <button
                            key={aspect.value}
                            aria-pressed={preferences.aspect === aspect.value}
                            onClick={() =>
                              setPreferences((previous) => ({
                                ...previous,
                                aspect: aspect.value,
                              }))
                            }
                          >
                            {aspect.label}
                          </button>
                        ))}
                      </div>
                      <p className="field-help">
                        {preferences.aspect === 'original'
                          ? 'Preserve the source shape.'
                          : 'Fit the entire video with padding. No cropping.'}
                      </p>
                    </fieldset>
                    <button
                      className="popup-primary"
                      disabled={locked || Boolean(clipError) || !ready}
                      onClick={() => void state.startExport()}
                    >
                      {starting || processing ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <ArrowDownToLine size={16} />
                      )}{' '}
                      {starting
                        ? 'Starting export…'
                        : processing
                          ? 'Preparing video…'
                          : 'Prepare for X'}
                    </button>
                    <p className="export-note">
                      <ShieldCheck size={12} />
                      MP4 · H.264 + AAC · verified before download
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
        <footer>
          Everything stays in this popup. Processing continues when it closes.
          <br />
          Only download videos you have permission to use.
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <Popup />
  </MotionConfig>,
);
