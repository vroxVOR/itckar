"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import { RescheduleForm } from "./reschedule-form";

type Move = { id: string; expectedStart: number; date: string; time: string; label: string };
type Drag = { id: string; expectedStart: number; offset: number; grab: number; resource: string; label: string };

/** Server-rendered grid stays intact; only drag/drop and the confirmation dialog are interactive. */
export function CalendarMove({ children, zone, step }: { children: ReactNode; zone: string; step: number }) {
  const drag = useRef<Drag | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const done = useCallback(() => { setMove(null); setMessage("Rezervácia bola presunutá."); router.refresh(); }, [router]);
  useEffect(() => { if (move) dialog.current?.showModal(); }, [move]);

  function start(e: DragEvent) {
    const event = (e.target as HTMLElement).closest<HTMLElement>("[data-move-id]");
    if (!event) { e.preventDefault(); return; }
    drag.current = {
      id: event.dataset.moveId!, expectedStart: Number(event.dataset.start), offset: Number(event.dataset.offset),
      grab: e.clientY - event.getBoundingClientRect().top,
      resource: event.closest<HTMLElement>("[data-calendar-day]")?.dataset.resource ?? "",
      label: event.title,
    };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", event.dataset.moveId!);
    setMessage("");
  }
  function drop(e: DragEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.preventDefault();
    const column = (e.target as HTMLElement).closest<HTMLElement>("[data-calendar-day]");
    if (!column) return;
    if ((column.dataset.resource ?? "") !== d.resource) {
      setMessage("Presun zachováva personál. Vyberte čas v rovnakom stĺpci alebo deň v týždennom pohľade.");
      return;
    }
    const minute = Math.round(((e.clientY - column.getBoundingClientRect().top - d.grab) / 1.2 - d.offset / 60000) / step) * step;
    const target = DateTime.fromISO(column.dataset.calendarDay!, { zone }).set({ hour: 7 }).plus({ minutes: minute });
    if (target.toMillis() === d.expectedStart) return;
    setMove({ id: d.id, expectedStart: d.expectedStart, date: target.toISODate()!, time: target.toFormat("HH:mm"), label: d.label });
  }
  return (
    <div onDragStart={start} onDragEnd={() => { drag.current = null; }} onDragOver={(e) => { if (drag.current) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={drop}>
      <p className="mb-2 text-xs text-neutral-500">Potiahnite rezerváciu na nový čas a potvrďte presun. Na mobile alebo klávesnicou použite „Presunúť rezerváciu“ v jej detaile.</p>
      {message && <p role="status" className="mb-3 rounded-lg bg-brand-50 p-3 text-sm">{message}</p>}
      {children}
      {move && <dialog ref={dialog} aria-labelledby="reschedule-title" onCancel={(e) => { if (dialog.current?.querySelector('form[data-saving="true"]')) e.preventDefault(); else setMove(null); }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/30">
        <h2 id="reschedule-title" className="mb-2 text-lg font-semibold">Presunúť rezerváciu</h2>
        <p className="mb-4 text-sm text-neutral-600">{move.label}</p>
        <RescheduleForm id={move.id} expectedStart={move.expectedStart} date={move.date} time={move.time} zone={zone} onDone={done} onCancel={() => setMove(null)} />
      </dialog>}
    </div>
  );
}
