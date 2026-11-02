// SPDX-License-Identifier: MIT
// The panels of the tools that need choices before they run (SPEC 5.5): Merge PDFs, Split PDF,
// Edit PDF, PDF from images and Read QR codes. Each one starts a job and closes, except QR, which
// shows what it found and saves a report on request.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { isMediaPanel, MediaEditor } from '../editors';
import { Icon } from '../components/Icon';
import { api, type FileEntry, type PageSize, type QrFound, type QrReport } from '../ipc';
import { useApp, type PanelTool } from '../state/store';
import { move, OrderList } from './OrderList';
import { parseRanges } from './ranges';

export function ToolPanel() {
  const { panel, closePanel, files } = useApp();
  const entries = useMemo(
    () =>
      panel
        ? panel.paths
            .map((path) => files.find((file) => file.path === path))
            .filter((file): file is FileEntry => Boolean(file))
        : [],
    [panel, files],
  );
  // Media editors take the paths as they are; they read the files themselves.
  if (panel && isMediaPanel(panel.tool)) {
    return (
      <MediaEditor
        tool={panel.tool}
        paths={panel.paths}
        onClose={closePanel}
        onStarted={(ids) => useApp.getState().started(ids)}
      />
    );
  }
  if (!panel || !entries.length) return null;
  const props = { entries, onClose: closePanel };
  const panels: Partial<Record<PanelTool, ReactNode>> = {
    'merge-pdf': <MergePdf {...props} />,
    'split-pdf': <SplitPdf {...props} />,
    'edit-pdf': <EditPdf {...props} />,
    'images-to-pdf': <ImagesToPdf {...props} />,
    'read-qr': <ReadQr {...props} />,
  };
  return panels[panel.tool];
}

interface PanelProps {
  entries: FileEntry[];
  onClose(): void;
}

/** Runs a job request, records it as this window's and closes the panel; errors stay visible. */
function useStart(onClose: () => void) {
  const { started } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = (request: Promise<number | number[]>) => {
    setBusy(true);
    request
      .then((ids) => {
        started(Array.isArray(ids) ? ids : [ids]);
        onClose();
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
  return { start, error, busy };
}

function Footer({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" className="button quiet" onClick={onClose}>
        {t('tools.cancel')}
      </button>
      {children}
    </>
  );
}

function MergePdf({ entries, onClose }: PanelProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState(entries);
  const { start, error, busy } = useStart(onClose);
  return (
    <Dialog
      title={t('tool.merge-pdf')}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <button
            type="button"
            className="button primary"
            disabled={busy || order.length < 2}
            onClick={() => start(api.mergePdfs(order.map((f) => f.path)))}
          >
            {t('tools.merge.run', { count: order.length })}
          </button>
        </Footer>
      }
    >
      <p className="muted">{t('tools.merge.text')}</p>
      <OrderList items={order} onChange={setOrder} />
      {error && <p className="error-text">{error}</p>}
    </Dialog>
  );
}

function usePages(path: string) {
  const [pages, setPages] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .pdfPages(path)
      .then((count) => live && setPages(count))
      .catch((error) => live && setFailed(String(error)));
    return () => {
      live = false;
    };
  }, [path]);
  return { pages, failed };
}

function SplitPdf({ entries, onClose }: PanelProps) {
  const { t } = useTranslation();
  const file = entries[0]!;
  const { pages, failed } = usePages(file.path);
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [every, setEvery] = useState(1);
  const [text, setText] = useState('');
  const { start, error, busy } = useStart(onClose);
  const ranges = pages ? parseRanges(text, pages) : null;
  const ready = pages != null && (mode === 'every' ? every >= 1 && every <= pages : ranges != null);
  return (
    <Dialog
      title={t('tool.split-pdf')}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <button
            type="button"
            className="button primary"
            disabled={busy || !ready}
            onClick={() =>
              start(
                api.splitPdf(
                  file.path,
                  mode === 'every' ? { kind: 'every', pages: every } : { kind: 'ranges', ranges: ranges! },
                ),
              )
            }
          >
            {t('tools.split.run')}
          </button>
        </Footer>
      }
    >
      <p>
        <bdi>{file.name}</bdi>
        {pages != null && <span className="muted"> · {t('tools.pages', { count: pages })}</span>}
      </p>
      {failed && <p className="error-text">{failed}</p>}
      <fieldset className="choices">
        <legend className="visually-hidden">{t('tool.split-pdf')}</legend>
        <label className="choice">
          <input type="radio" name="split" checked={mode === 'every'} onChange={() => setMode('every')} />
          {t('tools.split.every')}
          <input
            type="number"
            min={1}
            max={pages ?? undefined}
            value={every}
            disabled={mode !== 'every'}
            aria-label={t('tools.split.everyCount')}
            onChange={(event) => setEvery(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <label className="choice">
          <input type="radio" name="split" checked={mode === 'ranges'} onChange={() => setMode('ranges')} />
          {t('tools.split.ranges')}
          <input
            type="text"
            inputMode="numeric"
            placeholder={t('tools.split.rangesExample')}
            value={text}
            disabled={mode !== 'ranges'}
            aria-invalid={mode === 'ranges' && text !== '' && !ranges}
            aria-label={t('tools.split.ranges')}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {mode === 'ranges' && text !== '' && !ranges && pages != null && (
          <p className="error-text">{t('tools.split.invalid', { count: pages })}</p>
        )}
      </fieldset>
      {error && <p className="error-text">{error}</p>}
    </Dialog>
  );
}

interface Page {
  index: number;
  rotate: number;
}

function PageThumb({ path, page }: { path: string; page: Page }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    void api.pdfThumbnail(path, page.index, 220).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, page.index]);
  return (
    <span className="page-thumb" style={{ transform: `rotate(${page.rotate}deg)` }}>
      {src ? <img src={src} alt="" /> : <Icon name="pdf" size={28} />}
    </span>
  );
}

function allPages(count: number): Page[] {
  return Array.from({ length: count }, (_, index) => ({ index, rotate: 0 }));
}

function EditPdf({ entries, onClose }: PanelProps) {
  const { t } = useTranslation();
  const file = entries[0]!;
  const { pages, failed } = usePages(file.path);
  // Every page as it is until the first change.
  const [edited, setEdited] = useState<Page[] | null>(null);
  const order = edited ?? allPages(pages ?? 0);
  const setOrder = (change: (current: Page[]) => Page[]) => setEdited(change(order));
  const [dragged, setDragged] = useState<number | null>(null);
  const { start, error, busy } = useStart(onClose);
  const turn = (at: number, by: number) =>
    setOrder((current) =>
      current.map((page, i) => (i === at ? { ...page, rotate: (page.rotate + by + 360) % 360 } : page)),
    );
  const changed =
    pages != null && (order.length !== pages || order.some((page, i) => page.index !== i || page.rotate !== 0));

  return (
    <Dialog
      wide
      title={t('tool.edit-pdf')}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <button
            type="button"
            className="button primary"
            disabled={busy || !changed || order.length === 0}
            onClick={() => start(api.editPdf(file.path, order))}
          >
            {t('tools.edit.run')}
          </button>
        </Footer>
      }
    >
      <p className="muted">{t('tools.edit.text')}</p>
      {failed && <p className="error-text">{failed}</p>}
      <ol className="page-grid">
        {order.map((page, at) => (
          <li
            key={page.index}
            className="page-card"
            tabIndex={0}
            draggable
            data-dragging={dragged === at || undefined}
            aria-label={t('tools.edit.page', { page: page.index + 1, position: at + 1 })}
            onDragStart={() => setDragged(at)}
            onDragEnd={() => setDragged(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged != null) setOrder((current) => move(current, dragged, at));
              setDragged(null);
            }}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              // Left and right follow the reading direction.
              const rtl = document.documentElement.dir === 'rtl';
              const steps: Record<string, number> = {
                ArrowUp: -1,
                ArrowDown: 1,
                ArrowLeft: rtl ? 1 : -1,
                ArrowRight: rtl ? -1 : 1,
              };
              const step = steps[event.key];
              if (!step) return;
              event.preventDefault();
              setOrder((current) => move(current, at, at + step));
            }}
          >
            <PageThumb path={file.path} page={page} />
            <span className="page-number">{page.index + 1}</span>
            <span className="page-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={t('tools.edit.left')}
                onClick={() => turn(at, -90)}
              >
                <Icon name="rotate-left" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('tools.edit.right')}
                onClick={() => turn(at, 90)}
              >
                <Icon name="rotate-right" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('tools.edit.remove')}
                onClick={() => setOrder((current) => current.filter((_, i) => i !== at))}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {pages != null && order.length < pages && (
        <button type="button" className="button quiet small" onClick={() => setEdited(null)}>
          {t('tools.edit.reset')}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </Dialog>
  );
}

function ImagesToPdf({ entries, onClose }: PanelProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState(entries);
  const [size, setSize] = useState<PageSize>('fit-image');
  const [margin, setMargin] = useState(0);
  const { start, error, busy } = useStart(onClose);
  return (
    <Dialog
      title={t('tool.images-to-pdf')}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() =>
              start(
                api.imagesToPdf(
                  order.map((f) => f.path),
                  { size, marginMm: margin },
                ),
              )
            }
          >
            {t('tools.images.run', { count: order.length })}
          </button>
        </Footer>
      }
    >
      <OrderList items={order} onChange={setOrder} />
      <div className="form-row">
        <label>
          {t('tools.images.size')}
          <select value={size} onChange={(event) => setSize(event.target.value as PageSize)}>
            <option value="fit-image">{t('tools.images.fit')}</option>
            <option value="a4">A4</option>
            <option value="letter">{t('tools.images.letter')}</option>
          </select>
        </label>
        <label>
          {t('tools.images.margin')}
          <select value={margin} onChange={(event) => setMargin(Number(event.target.value))}>
            {[0, 5, 10, 20].map((mm) => (
              <option key={mm} value={mm}>
                {t('tools.images.mm', { mm })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
    </Dialog>
  );
}

function ReadQr({ entries, onClose }: PanelProps) {
  const { t } = useTranslation();
  const { toast, boot } = useApp();
  const [found, setFound] = useState<QrFound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mac = boot?.app.platform === 'macos';
  useEffect(() => {
    let live = true;
    api
      .scanQr(entries.map((entry) => entry.path))
      .then((codes) => live && setFound(codes))
      .catch((reason) => live && setError(String(reason)));
    return () => {
      live = false;
    };
  }, [entries]);
  const name = (path: string) => entries.find((entry) => entry.path === path)?.name ?? path;
  const save = (report: QrReport) =>
    api
      .saveQrReport(found ?? [], report)
      .then((item) => {
        toast({ kind: 'info', message: t('tools.qr.saved', { name: item.name }) });
        void api.libraryReveal(item.id);
      })
      .catch((reason) => setError(String(reason)));

  return (
    <Dialog
      title={t('tool.read-qr')}
      onClose={onClose}
      footer={
        <Footer onClose={onClose}>
          {(['txt', 'csv', 'json'] as QrReport[]).map((report) => (
            <button
              key={report}
              type="button"
              className="button"
              disabled={!found?.length}
              onClick={() => void save(report)}
            >
              {t('tools.qr.save', { format: report.toUpperCase() })}
            </button>
          ))}
        </Footer>
      }
    >
      {found == null && !error && <p className="muted">{t('tools.qr.scanning')}</p>}
      {found?.length === 0 && <p className="muted">{t('tools.qr.none')}</p>}
      {found && found.length > 0 && (
        <ul className="qr-list">
          {found.map((code, index) => (
            <li key={index} className="qr-item">
              <span className="muted">
                <bdi>{name(code.file)}</bdi>
                {code.page != null && ` · ${t('tools.qr.page', { page: code.page })}`}
              </span>
              <bdi className="qr-text">{code.text}</bdi>
              <button
                type="button"
                className="icon-button"
                aria-label={t('tools.qr.copy')}
                title={mac ? '⌘C' : 'Ctrl+C'}
                onClick={() => void navigator.clipboard.writeText(code.text)}
              >
                <Icon name="copy" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text">{error}</p>}
    </Dialog>
  );
}
