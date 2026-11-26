import { useEffect, useId, useRef, useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { alpha, type Theme } from '@mui/material/styles';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, AlertTitle, Box, Button, Checkbox, Chip,
  Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, List, ListItem,
  ListItemButton, Stack, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { clearSyncLog, readSyncLog, subscribeToSyncLog } from '../util/sync/diagnostics';
import {
  attemptMessage, attemptStatus, elapsedLabel, imageFields, outcomeLabels, photoSkipCount, stepLabels, stepMessage,
  stepStatus, stepTitle, syncReport, triggerLabels, type DiagnosticRun, type DiagnosticStep,
} from '../util/sync/diagnostics-model';

const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dateTime = (started: number) => `${date.format(started)}, ${time.format(started)}`;
const clearColor = (theme: Theme) => ({ color: theme.palette.error[theme.palette.mode === 'dark' ? 'light' : 'dark'] });

function RunStatus({ run }: { run: DiagnosticRun }) {
  return <Chip size="small" label={outcomeLabels[run.outcome]} sx={theme => {
    if (run.outcome === 'unknown') return {};
    const dark = theme.palette.mode === 'dark';
    const tone = run.outcome === 'failed' ? theme.palette.error : theme.palette.success;
    return { bgcolor: alpha(tone.main, dark ? 0.18 : 0.10), color: dark ? tone.light : tone.dark, fontWeight: 600 };
  }} />;
}

function StepDetails({ step }: { step: DiagnosticStep }) {
  const message = stepMessage(step);
  return <Stack gap={0.5}>
    <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace' }}>{stepLabels[step.kind][1]} · {elapsedLabel(step.elapsed)}</Typography>
    {message && <Typography variant="body2">{message}</Typography>}
    {step.attempts.length > 1 && <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
      {step.attempts.map((attempt, index) => <Typography key={index} variant="caption" component="li">
        {attemptStatus(attempt)} · {elapsedLabel(attempt.elapsed)}{attemptMessage(attempt) ? ` · ${attemptMessage(attempt)}` : ''}
      </Typography>)}
    </Box>}
    {step.image && <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 0.5, m: 0, pt: 0.75, mt: 0.5, borderTop: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
      {imageFields(step.image, true).map(([label, value]) => <Box key={label} sx={{ gridColumn: label === 'Photo for' ? '1 / -1' : undefined }}>
        <Typography component="dt" variant="caption">{label}</Typography>
        <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 600 }}>{value}</Typography>
      </Box>)}
    </Box>}
  </Stack>;
}

function RunDetails({ run }: { run: DiagnosticRun }) {
  const stepsId = useId();
  const highlighted = run.outcome === 'failed'
    ? [...run.steps].reverse().find(step => step.outcome === 'failed') ?? run.steps.at(-1)
    : run.outcome === 'unknown' ? run.steps.at(-1) : undefined;
  const steps = run.steps.filter(step => step !== highlighted);
  const skipped = photoSkipCount(run);
  const reused = run.steps.filter(step => step.kind === 'reuse').reduce((total, step) => total + (step.count ?? 0), 0);
  const end = run.endedAt === undefined ? 'End time unknown' : date.format(run.startedAt) === date.format(run.endedAt)
    ? time.format(run.endedAt) : dateTime(run.endedAt);
  return <Stack component="section" aria-label="Selected run" gap={1} sx={{ p: 2, minWidth: 0 }}>
    <Typography variant="subtitle1" component="h3" fontWeight={700}>
      {run.outcome === 'failed' ? 'Failed run' : run.outcome === 'succeeded' ? 'Successful run' : 'Outcome unknown'}
    </Typography>
    <Typography variant="body2" color="text.secondary">{dateTime(run.startedAt)} – {end} · {triggerLabels[run.trigger]}</Typography>
    {highlighted && <Alert icon={false} variant="outlined" severity={run.outcome === 'failed' ? 'error' : 'info'} sx={{
      bgcolor: theme => theme.palette[run.outcome === 'failed' ? 'error' : 'info'].light + '12',
    }}>
      <AlertTitle>{stepTitle(highlighted)} · {stepStatus(highlighted)}</AlertTitle>
      <StepDetails step={highlighted} />
    </Alert>}
    {run.outcome === 'succeeded' && <Alert icon={false} variant="outlined" severity="success">
      <AlertTitle sx={{ mb: reused ? undefined : 0 }}>Snapshot published</AlertTitle>
      {reused > 0 && `${reused} verified cloud ${reused === 1 ? 'image' : 'images'} reused.`}
    </Alert>}
    {skipped > 0 && <Alert severity="warning" variant="outlined">
      {skipped === 1 ? '1 photo skipped.' : `${skipped} photo skips.`} Open run steps for available details.
    </Alert>}
    {run.omitted > 0 && <Typography variant="body2" color="text.secondary">
      {run.omitted} {run.omitted === 1 ? 'step' : 'steps'} omitted to fit local history.
    </Typography>}
    {steps.length > 0 && <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&::before': { display: 'none' } }}>
      <AccordionSummary id={`${stepsId}-summary`} aria-controls={`${stepsId}-content`} expandIcon={<ExpandMoreIcon />}
        sx={{ px: 0, color: 'primary.main', justifyContent: 'flex-start', '& .MuiAccordionSummary-content': { flexGrow: 0, mr: 1 } }}>
        {highlighted && steps.every(step => step.sequence < highlighted.sequence) ? 'Earlier steps' : 'Run steps'} ({steps.length})
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <List component="ol" dense disablePadding aria-label="Run steps">
          {steps.map(step => <ListItem key={step.sequence} divider disableGutters sx={{ display: 'block', py: 1 }}>
            <Typography variant="body2" fontWeight={600}>{stepTitle(step)} · {stepStatus(step)}</Typography>
            <StepDetails step={step} />
          </ListItem>)}
        </List>
      </AccordionDetails>
    </Accordion>}
  </Stack>;
}

export function SyncLogDialog() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const [log, setLog] = useState(readSyncLog);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [includeNames, setIncludeNames] = useState(false);
  const [fallback, setFallback] = useState<{ text: string; runId: string }>();
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const empty = useRef<HTMLParagraphElement>(null);
  const reportField = useRef<HTMLTextAreaElement>(null);
  const moveToEmpty = useRef(false);
  const copyVersion = useRef(0);
  useEffect(() => {
    const update = () => setLog(readSyncLog());
    const unsubscribe = subscribeToSyncLog(update);
    update();
    return unsubscribe;
  }, []);
  const active = log.runs.find(run => run.id === selection) ?? log.runs[0];
  const copyFallback = fallback?.runId === active?.id ? fallback : undefined;

  function resetCopy() {
    copyVersion.current++;
    setFallback(undefined);
    setFeedback('');
  }
  function closeLog() {
    setOpen(false);
    setIncludeNames(false);
    resetCopy();
  }
  async function copy() {
    if (!active) return;
    const version = ++copyVersion.current;
    setFeedback('');
    const text = syncReport(active, includeNames);
    try {
      await navigator.clipboard.writeText(text);
      if (version === copyVersion.current) setFeedback('Report copied.');
    } catch {
      if (version === copyVersion.current) setFallback({ text, runId: active.id });
    }
  }

  const latest = log.runs[0];
  const photosSkipped = latest?.outcome === 'succeeded' && photoSkipCount(latest) > 0;
  const openLog = () => { setSelection(undefined); setOpen(true); };

  return <>
    <Stack direction="row" gap={1} alignItems="center" justifyContent="center" sx={{ mt: 2 }}>
      <Button variant="outlined" onClick={openLog}>Sync log</Button>
      {photosSkipped ? <Chip size="small" label="Photos skipped" variant="outlined" color="warning"
        sx={theme => ({ color: theme.palette.warning[theme.palette.mode === 'dark' ? 'light' : 'dark'] })}
        aria-label="Open sync log for skipped photos" onClick={openLog} /> : latest && <RunStatus run={latest} />}
    </Stack>
    <Dialog open={open} onClose={closeLog}
      fullWidth maxWidth="md" fullScreen={phone} aria-labelledby={titleId}>
      <DialogTitle id={`${titleId}-header`} component="div" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', px: 2, py: 1.5 }}>
        <Box>
          <Typography id={titleId} variant="h6" component="h2" sx={{ lineHeight: 1.35 }}>Sync log</Typography>
          <Typography variant="body2" color="text.secondary">On this device · up to 5 runs</Typography>
        </Box>
        <IconButton autoFocus aria-label="Close sync log" onClick={closeLog}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {log.temporary && <Alert severity="warning" variant="filled" sx={{ borderRadius: 0 }}>
          Sync history is temporary in this browser session.
        </Alert>}
        {active ? <Box sx={{ display: { sm: 'grid' }, gridTemplateColumns: '245px minmax(0, 1fr)' }}>
          <Box component="section" aria-label="Recent runs" sx={{ borderColor: 'divider', borderStyle: 'solid',
            borderWidth: { xs: '0 0 1px', sm: '0 1px 0 0' } }}>
            <Typography variant="subtitle2" color="text.secondary" component="h3" sx={{ px: 2, pt: 1 }}>Recent runs</Typography>
            <List dense disablePadding>
              {log.runs.map(run => <ListItem key={run.id} disablePadding>
                <ListItemButton selected={run.id === active.id} aria-pressed={run.id === active.id}
                  onClick={() => { setSelection(run.id); resetCopy(); }}
                  sx={{ gap: 1, justifyContent: 'space-between', borderLeft: 3,
                    borderColor: run.id === active.id ? 'primary.main' : 'transparent', pl: 1.6 }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{dateTime(run.startedAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">{triggerLabels[run.trigger]}</Typography>
                  </Box>
                  <RunStatus run={run} />
                </ListItemButton>
              </ListItem>)}
            </List>
          </Box>
          <RunDetails key={active.id} run={active} />
        </Box> : <Typography ref={empty} tabIndex={-1} sx={{ p: 2 }}>No sync runs recorded yet.</Typography>}
      </DialogContent>
      <DialogActions sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, px: 2, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <FormControlLabel disabled={!active} control={<Checkbox size="small" checked={includeNames}
          onChange={(_, checked) => { setIncludeNames(checked); setFeedback(''); }} />}
          label={<Typography variant="body2">Include recipe and meal names</Typography>} />
        <Stack direction="row" gap={1} sx={{ width: { xs: '100%', sm: 'auto' }, ml: '0 !important' }}>
          <Button color="error" sx={clearColor} disabled={!active} onClick={() => setConfirm(true)}>Clear log</Button>
          <Button variant="outlined" disabled={!active} onClick={() => void copy()}>Copy report</Button>
        </Stack>
        <Typography role="status" variant="body2" color="success" sx={{ flexBasis: '100%', position: feedback ? 'static' : 'absolute', ml: '0 !important' }}>{feedback}</Typography>
      </DialogActions>
    </Dialog>
    <Dialog open={confirm} onClose={() => { if (!clearing) setConfirm(false); }} aria-labelledby={`${titleId}-clear`} aria-describedby={`${titleId}-clear-text`}
      slotProps={{ transition: { onExited: () => { if (moveToEmpty.current) { moveToEmpty.current = false; empty.current?.focus(); } } } }}>
      <DialogTitle id={`${titleId}-clear`}>Clear sync log?</DialogTitle>
      <DialogContent><Typography id={`${titleId}-clear-text`}>This removes all sync diagnostics saved on this device.</Typography></DialogContent>
      <DialogActions>
        <Button autoFocus disabled={clearing} onClick={() => setConfirm(false)}>Cancel</Button>
        <Button color="error" sx={clearColor} disabled={clearing} onClick={async () => {
          resetCopy(); setIncludeNames(false); setSelection(undefined); setClearing(true);
          await clearSyncLog();
          moveToEmpty.current = true; setConfirm(false); setClearing(false);
        }}>Clear log</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={!!copyFallback} onClose={() => setFallback(undefined)} aria-labelledby={`${titleId}-copy`} maxWidth="sm" fullWidth
      slotProps={{ transition: { onEntered: () => { reportField.current?.focus(); reportField.current?.select(); } } }}>
      <DialogTitle id={`${titleId}-copy`}>Copy report</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>Clipboard access is unavailable. Select and copy the text. On a phone, touch and hold the text for copy options.</Typography>
        <TextField fullWidth multiline minRows={6} maxRows={12} value={copyFallback?.text ?? ''}
          inputRef={reportField} slotProps={{ input: { readOnly: true }, htmlInput: { 'aria-label': 'Selectable report' } }} />
      </DialogContent>
      <DialogActions><Button onClick={() => setFallback(undefined)}>Close</Button></DialogActions>
    </Dialog>
  </>;
}
