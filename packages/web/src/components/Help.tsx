import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useOffice } from "../store";

const KEYS: Array<[string[], string]> = [
  [["Ctrl K", "/"], "Command palette: jump to anything"],
  [["?"], "This list"],
  [["Esc"], "Close, then deselect"],
  [["Drag", "Wheel"], "Pan, and zoom (whole steps keep the pixels sharp)"],
  [["Arrows"], "Pan the camera (canvas focused)"],
  [["+", "-", "0"], "Zoom in, out, fit the floor"],
  [["N", "P"], "Next, previous agent"],
  [["Z"], "Full screen: only the office, scaled to fill the window"],
  [["F"], "Follow the selected agent"],
  [["D"], "Director mode: the camera flies to the action (wall display)"],
  [["["], "Hide or show the crew list"],
  [["M"], "Hide or show the minimap"],
  [["Click Biscuit"], "Pet the office cat"],
];

export function Help() {
  const open = useOffice((s) => s.helpOpen);
  const setOpen = useOffice((s) => s.setHelpOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg" aria-describedby="help-desc">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="help-desc">Automicvault only reads. Nothing here can change an agent, a lane or a desk item.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2">
          {KEYS.map(([keys, what]) => (
            <div key={what} className="grid grid-cols-[9.5rem_1fr] items-center gap-3">
              <dt className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd className="m-0 text-sm text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
