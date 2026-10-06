import {
  Bot,
  Check,
  ChevronRight,
  FolderGit2,
  Image as ImageIcon,
  ImagePlus,
  Laptop,
  ListTodo,
  PhoneOutgoing,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelDispatch,
  createDispatch,
  type DaemonLink,
  daemonLabel,
  fetchDispatches,
  lookupDispatch,
  uploadDispatchImage,
} from "../daemonLink.ts";
import {
  dispatchTag,
  failureMessage,
  initialPick,
  loadLastPick,
  refusalMessage,
  saveLastPick,
} from "../dispatch.ts";
import {
  ImageRejectedError,
  type PickedImage,
  pickImage,
  releaseImage,
  toDispatchImage,
} from "../dispatchImages.ts";
import { errorMessage, formatDateTime } from "../format.ts";
import { useT } from "../i18n/index.ts";
import type {
  Device,
  Dispatch,
  DispatchAgent,
  DispatchAttachment,
  DispatchProject,
} from "../protocol.ts";
import { useDispatchOptions } from "../useDispatchOptions.ts";
import { useRingtone } from "../useRingtone.ts";
import { BackButton } from "./BackButton.tsx";

/** How often 呼叫中 asks whether the agent has created the issue yet. */
const CALLING_POLL_MS = 3_000;
/** How often 我的派单 is read again while open. */
const LIST_REFRESH_MS = 10_000;

type Stage =
  | { name: "compose" }
  /**
   * `dispatch` is null while the request is on its way to the computer; `uploaded` counts the
   * images already uploaded, one request each, before it.
   */
  | {
      name: "calling";
      agentName: string;
      projectTitle: string;
      dispatch: Dispatch | null;
      uploaded: number;
    }
  | { name: "failed"; message: string }
  | { name: "sent"; dispatch: Dispatch }
  | { name: "list" };

/**
 * 主动派单 (YOUT-222): say what needs doing on the phone, and the computer (whose outbrief-daemon
 * holds the Multica token) has the picked agent turn it into an issue with Multica's smart create.
 * The project and agent start from the last dispatch; the text box is for the keyboard's voice
 * input, and priority or due date are just said. While the computer is offline nothing can be
 * dispatched; the page says why and recovers by itself.
 */
export function DispatchScreen(props: {
  /** The daemon that dispatches; null when this device reaches none. */
  daemon: DaemonLink | null;
  /** The account's computers (relay only), to tell "no computer" from "no key yet". */
  daemons: Device[];
  /** What plays while 呼叫中 waits for the issue (设置 → 铃声). */
  ringtone: string;
  onBack: () => void;
}) {
  const msg = useT();
  const { daemon } = props;
  const [stage, setStage] = useState<Stage>({ name: "compose" });
  // Like calling someone: it rings from 呼叫中 until the issue is created, fails or is cancelled.
  useRingtone(stage.name === "calling" ? props.ringtone : null);
  const [said, setSaid] = useState("");
  // Screenshots / photos to send with it (YOUT-226); kept, like the text, when a dispatch fails.
  const [images, setImages] = useState<PickedImage[]>([]);
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  });
  useEffect(() => () => imagesRef.current.forEach(releaseImage), []);

  // 呼叫中: follow the dispatch until the agent has created the issue (or could not).
  const callingId = stage.name === "calling" ? stage.dispatch?.id : undefined;
  useEffect(() => {
    if (!daemon || !callingId) return;
    const ctrl = new AbortController();
    const poll = () =>
      lookupDispatch(daemon, callingId, ctrl.signal).then(
        (dispatch) => {
          if (ctrl.signal.aborted) return;
          if (dispatch.state === "created") setStage({ name: "sent", dispatch });
          else if (dispatch.state === "failed") {
            setStage({ name: "failed", message: failureMessage(dispatch.error) });
          } else if (dispatch.state === "cancelled") setStage({ name: "compose" });
        },
        (err: unknown) => !ctrl.signal.aborted && console.warn("[outbrief] dispatch lookup", err),
      );
    const timer = setInterval(poll, CALLING_POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [daemon, callingId]);

  const send = (link: DaemonLink, project: DispatchProject, agent: DispatchAgent) => {
    setStage({
      name: "calling",
      agentName: agent.name,
      projectTitle: project.title,
      dispatch: null,
      uploaded: 0,
    });
    // Like Multica, any number of images: each is uploaded on its own (up to Multica's 100 MB),
    // in the order they were attached, then the dispatch refers to them.
    const upload = async () => {
      const attachments: DispatchAttachment[] = [];
      for (const image of images) {
        attachments.push(await uploadDispatchImage(link, toDispatchImage(image)));
        setStage((s) => (s.name === "calling" ? { ...s, uploaded: attachments.length } : s));
      }
      return attachments;
    };
    upload()
      .then((attachments) =>
        createDispatch(link, {
          projectId: project.id,
          agentId: agent.id,
          prompt: said.trim(),
          attachments,
        }),
      )
      .then(
        (dispatch) => {
          saveLastPick({ projectId: project.id, agentId: agent.id });
          setSaid("");
          for (const image of images) releaseImage(image);
          setImages([]);
          setStage((s) => (s.name === "calling" ? { ...s, dispatch } : s));
        },
        (err: unknown) => {
          console.warn("[outbrief] dispatch", err);
          setStage({ name: "failed", message: refusalMessage(err, agent.name) });
        },
      );
  };

  if (stage.name === "calling") {
    const { dispatch } = stage;
    const cancel = () => {
      if (!daemon || !dispatch) return;
      setStage({ name: "compose" });
      cancelDispatch(daemon, dispatch.id).then(
        (d) => {
          // The agent was quicker: the issue already exists.
          if (d.state === "created") setStage({ name: "sent", dispatch: d });
        },
        (err: unknown) =>
          setStage({ name: "failed", message: msg.dispatch.cancelFailed(errorMessage(err)) }),
      );
    };
    return (
      <main className="screen call dispatch-calling">
        <div className="caller">
          <div className="avatar ringing">{stage.agentName.slice(0, 1)}</div>
          <h1>{stage.agentName}</h1>
          <p className="hint">
            {msg.dispatch.calling} · {stage.projectTitle}
          </p>
          <p className="muted">
            {dispatch
              ? msg.dispatch.creating(stage.agentName)
              : stage.uploaded < images.length
                ? msg.dispatch.uploading(stage.uploaded + 1, images.length)
                : msg.dispatch.sending}
          </p>
        </div>
        <div className="dispatch-calling-actions">
          <button
            type="button"
            className="round decline"
            aria-label={msg.common.cancel}
            disabled={!dispatch}
            onClick={cancel}
          >
            <X size={28} aria-hidden />
          </button>
          <span className="muted">{msg.common.cancel}</span>
          {dispatch && (
            <button type="button" className="link" onClick={() => setStage({ name: "list" })}>
              {msg.dispatch.leave}
            </button>
          )}
        </div>
      </main>
    );
  }

  if (stage.name === "failed") {
    return (
      <main className="screen dispatch">
        <header className="idle-header">
          <BackButton onClick={() => setStage({ name: "compose" })} />
          <span className="brand">{msg.dispatch.failedTitle}</span>
          <span className="header-spacer" />
        </header>
        <section className="dispatch-sent">
          <div className="dispatch-sent-icon failed">
            <X size={32} aria-hidden />
          </div>
          <p className="error">{stage.message}</p>
        </section>
        <div className="dispatch-actions">
          <button
            type="button"
            className="pill primary wide"
            onClick={() => setStage({ name: "compose" })}
          >
            {msg.dispatch.edit}
          </button>
        </div>
      </main>
    );
  }

  if (stage.name === "sent") {
    const d = stage.dispatch;
    return (
      <main className="screen dispatch">
        <header className="idle-header">
          <BackButton onClick={props.onBack} />
          <span className="brand">{msg.dispatch.sentTitle(d.agentName)}</span>
          <span className="header-spacer" />
        </header>
        <section className="dispatch-sent">
          <div className="dispatch-sent-icon">
            <Check size={32} aria-hidden />
          </div>
          <p className="idle-title">{msg.dispatch.sentTitle(d.agentName)}</p>
          <p className="muted">{msg.dispatch.sentHint}</p>
          <DispatchCard dispatch={d} />
        </section>
        <div className="dispatch-actions">
          <button
            type="button"
            className="pill primary wide"
            onClick={() => setStage({ name: "compose" })}
          >
            {msg.dispatch.again}
          </button>
          <button type="button" className="pill wide" onClick={() => setStage({ name: "list" })}>
            {msg.dispatch.mine}
          </button>
        </div>
      </main>
    );
  }

  if (stage.name === "list") {
    return <DispatchList daemon={daemon} onBack={() => setStage({ name: "compose" })} />;
  }

  return (
    <Compose
      daemon={daemon}
      daemons={props.daemons}
      said={said}
      onSay={setSaid}
      images={images}
      onAddImages={(added) => setImages((list) => [...list, ...added])}
      onRemoveImage={(image) => {
        releaseImage(image);
        setImages((list) => list.filter((i) => i.id !== image.id));
      }}
      onSend={send}
      onOpenList={() => setStage({ name: "list" })}
      onBack={props.onBack}
    />
  );
}

/** 方案 B: everything on one page; project and agent start from the last dispatch. */
function Compose(props: {
  daemon: DaemonLink | null;
  daemons: Device[];
  said: string;
  onSay: (said: string) => void;
  images: PickedImage[];
  onAddImages: (images: PickedImage[]) => void;
  onRemoveImage: (image: PickedImage) => void;
  onSend: (link: DaemonLink, project: DispatchProject, agent: DispatchAgent) => void;
  onOpenList: () => void;
  onBack: () => void;
}) {
  const msg = useT();
  const { daemon } = props;
  const { options, problem } = useDispatchOptions(daemon);
  const [pick, setPick] = useState<{ projectId: string | null; agentId: string | null } | null>(
    null,
  );
  const [picking, setPicking] = useState<"project" | "agent" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Images being read / shrunk, and why the last ones could not be added.
  const [reading, setReading] = useState(0);
  const [imageProblem, setImageProblem] = useState<string | null>(null);

  /** Adds picked, pasted or dropped files; what is not an image or is too big is said why. */
  const addImages = (files: File[]) => {
    if (!files.length) return;
    setImageProblem(null);
    setReading((n) => n + files.length);
    void Promise.allSettled(files.map(pickImage)).then((results) => {
      setReading((n) => n - files.length);
      const rejected = results.find((r) => r.status === "rejected");
      if (rejected) {
        const err: unknown = rejected.reason;
        console.warn("[outbrief] dispatch image", err);
        setImageProblem(
          err instanceof ImageRejectedError
            ? msg.dispatch.imageRejected[err.reason]
            : errorMessage(err),
        );
      }
      props.onAddImages(results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
    });
  };

  // The first options read picks the last dispatch's project and agent.
  useEffect(() => {
    if (!options || pick) return;
    const first = initialPick(options, loadLastPick());
    setPick({ projectId: first.project?.id ?? null, agentId: first.agent?.id ?? null });
  }, [options, pick]);

  // Looked up in the latest options, so an agent's online state follows its computer.
  const project = options?.projects.find((p) => p.id === pick?.projectId) ?? null;
  const agent = options?.agents.find((a) => a.id === pick?.agentId) ?? null;

  const offline = !daemon
    ? props.daemons.length
      ? msg.dispatch.needsAccount
      : msg.daemon.none
    : problem;
  const blocker =
    offline ??
    (!options
      ? msg.dispatch.loading
      : !project
        ? msg.dispatch.noProjects
        : !agent
          ? msg.dispatch.noAgents
          : !agent.online
            ? msg.dispatch.agentUnavailable(agent.name)
            : null);
  const ready = !blocker && !reading && (props.said.trim().length > 0 || props.images.length > 0);

  return (
    <main className="screen dispatch">
      <header className="idle-header">
        <BackButton onClick={props.onBack} />
        <span className="brand">{msg.dispatch.title}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={msg.dispatch.mine}
          title={msg.dispatch.mine}
          onClick={props.onOpenList}
        >
          <ListTodo size={20} aria-hidden />
        </button>
      </header>
      <p className={`dispatch-machine ${offline ? "offline" : "online"}`}>
        {offline ? <WifiOff size={14} aria-hidden /> : <Laptop size={14} aria-hidden />}
        {offline ??
          (daemon && options
            ? daemon.kind === "local"
              ? msg.dispatch.localOnline
              : msg.dispatch.online(daemonLabel(daemon))
            : msg.dispatch.loading)}
      </p>
      <section className="dispatch-step">
        <div className="settings-group">
          <ul>
            <li>
              <button
                type="button"
                className="settings-row"
                disabled={!options}
                onClick={() => setPicking("project")}
              >
                <FolderGit2 size={18} aria-hidden />
                <span className="settings-row-label">{msg.dispatch.project}</span>
                <span className="settings-row-value">{project?.title ?? msg.common.notSet}</span>
                <ChevronRight size={16} className="settings-row-chevron" aria-hidden />
              </button>
            </li>
            <li>
              <button
                type="button"
                className="settings-row"
                disabled={!options}
                onClick={() => setPicking("agent")}
              >
                <Bot size={18} aria-hidden />
                <span className="settings-row-label">{msg.dispatch.agent}</span>
                <span className="settings-row-value">{agent?.name ?? msg.common.notSet}</span>
                <ChevronRight size={16} className="settings-row-chevron" aria-hidden />
              </button>
            </li>
          </ul>
        </div>
        <div className="dispatch-say">
          <textarea
            value={props.said}
            rows={6}
            placeholder={msg.dispatch.placeholder}
            onChange={(e) => props.onSay(e.target.value)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              const files = imageFiles(e.dataTransfer.files);
              if (!files.length) return;
              e.preventDefault();
              addImages(files);
            }}
            onPaste={(e) => {
              // A copied screenshot is pasted as an image; text is pasted as usual.
              const files = imageFiles(e.clipboardData.files);
              if (!files.length) return;
              e.preventDefault();
              addImages(files);
            }}
          />
          <div className="dispatch-images">
            {props.images.map((image) => (
              <div key={image.id} className="dispatch-image">
                <img src={image.previewUrl} alt={image.name} />
                <button
                  type="button"
                  className="dispatch-image-remove"
                  aria-label={msg.dispatch.removeImage}
                  title={msg.dispatch.removeImage}
                  onClick={() => props.onRemoveImage(image)}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
            {Array.from({ length: reading }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <div key={i} className="dispatch-image reading" aria-hidden />
            ))}
            <button
              type="button"
              className="dispatch-image add"
              aria-label={msg.dispatch.addImage}
              title={msg.dispatch.addImage}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={22} aria-hidden />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addImages(imageFiles(e.target.files));
                // Picking the same file again after removing it must fire `change` again.
                e.target.value = "";
              }}
            />
          </div>
          {imageProblem && <p className="hint-line warn">{imageProblem}</p>}
          <button
            type="button"
            className="round accept dispatch-send"
            disabled={!ready}
            aria-label={msg.dispatch.send}
            title={msg.dispatch.send}
            onClick={() => daemon && project && agent && props.onSend(daemon, project, agent)}
          >
            <PhoneOutgoing size={26} aria-hidden />
          </button>
          {blocker && !offline && options && <p className="hint-line warn">{blocker}</p>}
        </div>
      </section>
      {picking && options && (
        <div className="dispatch-sheet-layer">
          <button
            type="button"
            className="dispatch-sheet-backdrop"
            aria-label={msg.dispatch.close}
            onClick={() => setPicking(null)}
          />
          <div className="dispatch-sheet">
            <p className="dispatch-step-title">
              {picking === "project" ? msg.dispatch.pickProject : msg.dispatch.pickAgent}
            </p>
            {picking === "project" ? (
              <ChoiceList
                items={options.projects.map((p) => ({ id: p.id, name: p.title, detail: null }))}
                icon={<FolderGit2 size={18} aria-hidden />}
                selected={project?.id}
                onPick={(id) => {
                  setPick((p) => ({ projectId: id, agentId: p?.agentId ?? null }));
                  setPicking(null);
                }}
              />
            ) : (
              <ChoiceList
                items={options.agents.map((a) => ({
                  id: a.id,
                  name: a.name,
                  detail: [
                    a.online ? msg.dispatch.agentOnline : msg.dispatch.agentOffline,
                    a.description,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
                icon={<Bot size={18} aria-hidden />}
                selected={agent?.id}
                onPick={(id) => {
                  setPick((p) => ({ projectId: p?.projectId ?? null, agentId: id }));
                  setPicking(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/** The images among dropped / pasted / picked files. */
function imageFiles(list: FileList | null): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
}

function ChoiceList(props: {
  items: { id: string; name: string; detail: string | null }[];
  icon: React.ReactNode;
  selected: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <div className="settings-group">
      <ul>
        {props.items.map((item) => (
          <li key={item.id}>
            <button type="button" className="settings-row" onClick={() => props.onPick(item.id)}>
              {props.icon}
              <span className="dispatch-choice">
                <span>{item.name}</span>
                {item.detail && <span className="dispatch-choice-detail">{item.detail}</span>}
              </span>
              {item.id === props.selected ? (
                <Check size={16} className="settings-row-chevron" aria-hidden />
              ) : (
                <ChevronRight size={16} className="settings-row-chevron" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 我的派单: what was dispatched from the computer, as it is now in Multica. */
function DispatchList(props: { daemon: DaemonLink | null; onBack: () => void }) {
  const msg = useT();
  const { daemon } = props;
  const [dispatches, setDispatches] = useState<Dispatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!daemon) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchDispatches(daemon, ctrl.signal).then(
        (list) => {
          if (ctrl.signal.aborted) return;
          setDispatches(list);
          setError(null);
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          console.warn("[outbrief] dispatches", err);
          setError(msg.dispatch.listFailed(errorMessage(err)));
        },
      );
    void load();
    const timer = setInterval(load, LIST_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [daemon, msg]);

  return (
    <main className="screen dispatch">
      <header className="idle-header">
        <BackButton onClick={props.onBack} />
        <span className="brand">{msg.dispatch.mine}</span>
        <span className="header-spacer" />
      </header>
      {error && <p className="hint-line warn">{error}</p>}
      {dispatches === null ? (
        !error && <p className="hint-line">{msg.dispatch.loading}</p>
      ) : dispatches.length === 0 ? (
        <p className="hint-line">{msg.dispatch.empty}</p>
      ) : (
        <ul className="dispatch-list">
          {dispatches.map((d) => (
            <li key={d.id}>
              <DispatchCard dispatch={d} showTime />
            </li>
          ))}
        </ul>
      )}
      <p className="hint-line">{msg.dispatch.listFootnote}</p>
    </main>
  );
}

function DispatchCard(props: { dispatch: Dispatch; showTime?: boolean }) {
  const msg = useT();
  const d = props.dispatch;
  return (
    <div className="dispatch-card">
      <div className="dispatch-card-top">
        {d.issue && <span className="mono">{d.issue.identifier}</span>}
        {props.showTime && (
          <span className="dispatch-card-meta">{formatDateTime(d.createdAt)}</span>
        )}
        <span className={`status-tag ${d.state}`}>{dispatchTag(d)}</span>
      </div>
      <p className="dispatch-card-title">
        {d.issue?.title ??
          (d.state === "creating" ? (
            <span className="dispatch-smart">
              <Sparkles size={14} aria-hidden /> {msg.dispatch.creatingTitle}
            </span>
          ) : (
            <span className="error">
              {d.state === "failed" ? failureMessage(d.error) : dispatchTag(d)}
            </span>
          ))}
      </p>
      <p className="dispatch-card-meta">{msg.dispatch.assignedTo(d.projectTitle, d.agentName)}</p>
      {d.prompt && <p className="dispatch-said">“{d.prompt}”</p>}
      {!!d.images && (
        <p className="dispatch-card-meta dispatch-card-images">
          <ImageIcon size={14} aria-hidden /> {msg.dispatch.images(d.images)}
        </p>
      )}
    </div>
  );
}
