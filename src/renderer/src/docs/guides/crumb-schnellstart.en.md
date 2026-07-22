# Quick start: something moves in five minutes

Hi! No long preamble — you're here to see something *happen*. By the end of this page a
tiny yellow ball is drifting across your C64 screen, and you built it yourself. No prior
knowledge, no drawing graphics, just a handful of lines.

Just type along. I'll explain as we go.

**Where do I type?** If no project is open yet, click **New file** at the top — BreadCraft
whips up a little throwaway project with a `main.crumb` and drops you right into it. That's
exactly where the code below goes: type it out or just paste it in.

---

## First, the stage

Three lines set up the screen:

```
SetMode TEXT
BorderColor BLACK
Cls BLUE
```

`SetMode TEXT` says: a normal text screen. `BorderColor BLACK` paints the frame all
around black. `Cls BLUE` wipes the middle clean and washes it blue. There's your stage —
empty and blue, ready for the show.

## Now, the show

A game doesn't run through once and finish. It repeats, frame by frame: move something,
wait a moment, start over. That's exactly what we'll write now.

```
SetMode TEXT
BorderColor BLACK
Cls BLUE

Color YELLOW          ; what we paint with: yellow
x.b = 0               ; the ball's position, hard left

While 1               ; "forever" — the main loop
  DrawText x, 12, " " ; wipe the ball from its old spot
  x.b = x + 1         ; one step to the right
  If x.b > 39 Then x.b = 0   ; hit the right edge? back in from the left
  DrawText x, 12, "O" ; paint the ball at its new spot
  VWait               ; wait one frame — that's what sets the calm pace
Wend
```

That's it. Now press **Build & Run**.

---

## What you're looking at

A yellow `O` ambles from left to right, vanishes at the edge, and slides back in from the
left. Forever. That's not magic, that's your program:

- `x.b` is the ball's **position**. `.b` just means "a small number from 0 to 255" —
  that's all you need to know about it right now.
- The **main loop** `While 1 … Wend` runs endlessly. On every pass we wipe the ball,
  nudge `x` one further, and paint it again. Fifty times a second.
- `VWait` is the quiet hero: it waits for the next frame each time. Without it the ball
  would tear across so fast you'd see only a flicker.

And there you have it — the basic shape of *every* game: change position, wait, repeat.
Everything else is just more balls and prettier pictures.

---

## Now play with it

The fastest way to get a feel for CRUMB is to turn the knobs. Change one little thing,
press Build & Run, watch what happens:

- Swap `YELLOW` for `RED`, `WHITE`, `CYAN` … 16 colours stand ready.
- Turn the `"O"` into a `"*"`, an `"A"`, or a whole word.
- Write `x.b = x + 2` — now the ball zips along twice as fast.
- Change the `12` (the row), and it runs higher up or lower down.

Break it and fix it. That's exactly how you learn.

---

### Where to next?

Every word CRUMB knows — with an example and an honest note on what it costs the C64 —
lives in the **Reference** in the sidebar. Have a rummage. And when you start building a
real game, tiles, sprites and the rest of the workshop are waiting for you there.
