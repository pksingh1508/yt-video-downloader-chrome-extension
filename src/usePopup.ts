import { useEffect, useRef, useState } from 'react';
import { api, downloadFile } from './api';
import { readDraft, saveDraft } from './draft';
import {
  canonicalYouTubeUrl,
  exportSchema,
  formatTime,
  isActive,
  parseTime,
  PROFILES,
  validateClip,
  type ExportOptions,
  type Health,
  type Job,
  type VideoInfo,
} from './shared';

type Preferences = Pick<ExportOptions, 'profile' | 'quality' | 'aspect'>;
function readPreferences(): Preferences {
  try {
    return exportSchema
      .pick({ profile: true, quality: true, aspect: true })
      .parse(
        JSON.parse(localStorage.getItem('postready-preferences') || 'null'),
      );
  } catch {
    return { profile: 'standard', quality: '720', aspect: 'original' };
  }
}

export function usePopup() {
  const [draft, setDraft] = useState(readDraft);
  const [preferences, setPreferences] = useState(readPreferences);
  const [tabUrl, setTabUrl] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [checked, setChecked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputEdited = useRef(false);
  const currentJob = jobs.find((job) => job.id === draft.jobId);
  const processing = Boolean(currentJob && isActive(currentJob));
  const options: ExportOptions = {
    ...preferences,
    videoToken: draft.video?.token || '',
    start: parseTime(draft.startTime),
    end: parseTime(draft.endTime),
  };
  const clipError = draft.video
    ? !exportSchema.safeParse(options).success
      ? 'Enter valid clip times, such as 0:05 or 1:30.'
      : validateClip(options, draft.video)
    : null;

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'postready-preferences',
        JSON.stringify(preferences),
      );
    } catch {
      /* In-memory editing remains available. */
    }
  }, [preferences]);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        try {
          const url = canonicalYouTubeUrl(tab?.url || '');
          setTabUrl(url);
          // Reopening a popup must restore the current edit rather than replace it.
          setDraft((previous) =>
            previous.url || previous.video || inputEdited.current
              ? previous
              : { ...previous, url },
          );
        } catch {
          /* A pasted URL works from any page. */
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      let active = false;
      try {
        const [nextHealth, nextJobs] = await Promise.all([
          api<Health>('/api/health', {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10_000),
            ]),
          }),
          api<Job[]>('/api/jobs', {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10_000),
            ]),
          }),
        ]);
        if (stopped) return;
        setHealth(nextHealth);
        setJobs(nextJobs);
        setConnected(true);
        active = nextJobs.some(isActive);
      } catch {
        if (!stopped) {
          setHealth(null);
          setConnected(false);
        }
      } finally {
        if (!stopped) {
          setChecked(true);
          timer = setTimeout(refresh, active ? 1000 : 5000);
        }
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  function setUrl(url: string) {
    inputEdited.current = true;
    setDraft((previous) => ({ ...previous, url }));
    setError('');
  }
  async function analyze(): Promise<boolean> {
    if (loading || processing || starting) return false;
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const url = canonicalYouTubeUrl(draft.url);
      const video = await api<VideoInfo>('/api/inspect', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setDraft((previous) => ({
        ...previous,
        url: video.url,
        video,
        view: 'create',
        jobId: null,
        startTime: '0:00',
        endTime: formatTime(
          Math.min(
            Math.floor(video.duration),
            PROFILES[preferences.profile].maxDuration,
          ),
        ),
      }));
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }
  async function startExport() {
    if (
      !draft.video ||
      clipError ||
      starting ||
      processing ||
      !connected ||
      !health?.ready
    )
      return;
    setError('');
    setNotice('');
    setStarting(true);
    try {
      const job = await api<Job>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(options),
      });
      setJobs((previous) => [
        job,
        ...previous.filter((item) => item.id !== job.id),
      ]);
      setDraft((previous) => ({ ...previous, jobId: job.id }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function saveFile(id: string) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await downloadFile(id);
      setNotice('Chrome is saving your MP4.');
    } catch (error) {
      setError(`Couldn’t save the MP4. ${(error as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }
  async function cancelJob(id: string) {
    setBusyId(id);
    setError('');
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
    setError('');
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      setJobs((previous) => previous.filter((job) => job.id !== id));
      setDraft((previous) =>
        previous.jobId === id ? { ...previous, jobId: null } : previous,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusyId(null);
    }
  }
  function selectJob(job: Job) {
    setPreferences({
      profile: job.options.profile,
      quality: job.options.quality,
      aspect: job.options.aspect,
    });
    setDraft({
      url: job.video.url,
      video: job.video,
      view: 'create',
      jobId: job.id,
      startTime: String(job.options.start),
      endTime: String(job.options.end),
    });
    setError('');
    setNotice('');
  }
  function reset() {
    setDraft({
      url: tabUrl,
      video: null,
      view: 'create',
      jobId: null,
      startTime: '0:00',
      endTime: '2:20',
    });
    setError('');
    setNotice('');
  }
  return {
    draft,
    setDraft,
    preferences,
    setPreferences,
    tabUrl,
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
    setUrl,
    analyze,
    startExport,
    saveFile,
    cancelJob,
    deleteJob,
    selectJob,
    reset,
  };
}
