# Deferred Items — Phase 126

## `DatasetsPage.spec.tsx` carries a test that passes for the wrong reason

**Found during:** 126-04 task 3, mutation probe **P4**. Recorded here by 126-05 at the operator
checkpoint, as 126-04's SUMMARY § "For plan 05" item 3 requested.

**The test:** `packages/web/src/components/DatasetsPage.spec.tsx` ::
`does NOT render ColumnFormatEditorModal before the button is clicked`.

**The defect:** it asserts only that the `ColumnFormatEditorModal` stub is **absent** from the DOM.
That assertion also holds when the `Format columns` button which opens the modal has been gated
away entirely — so the test cannot distinguish "the modal has not been opened yet" from "the
feature has been deleted".

**Evidence, measured rather than reasoned:** probe P4 added `canSchemaSync &&` to the
`Format columns` button (i.e. removed it for unprivileged users). That reddened **5 of the 6 tests**
in `DatasetsPage.spec.tsx` — `renders a 'Format columns' button`, `clicking 'Format columns'
renders ColumnFormatEditorModal`, both prop tests, and `calling onClose hides the modal`. This one
was the sole survivor. 126-04's plan predicted 6 reddened and the actual was 5; the difference **is**
this test.

**Why it was not fixed in 126-04:** that plan was explicitly forbidden to touch
`DatasetsPage.spec.tsx` (its acceptance criteria 8 and 9 assert the file is byte-unchanged from
`2ccb8c5`). 126-05 touches no `packages/web` source at all.

**Suggested fix:** give it a render-reached precondition before the absence assertion — assert the
`Format columns` button IS in the document first, exactly as
`DatasetsPage.schemasync.spec.tsx`'s three negative `GATE-` cases do. One line.

**Class:** this is the same "a guard that cannot fail manufactures confidence" failure CLAUDE.md
names, and the same one 126-03's probe P8 caught in flight in its own new test. Not urgent — the
production behaviour is correct and four sibling tests cover it — but it is a real hole in a guard.

---

## Not deferred, recorded for contrast

`126-02`'s `NOPOLL-no-check-on-mount`, `126-03`'s `NOPOLL-no-history-on-mount` and `126-04`'s
`GATE-neither` / `-datasets-only` / `-access-only` are all absence assertions too, and all three
groups carry an explicit render-reached proof for exactly this reason. The pattern is established
in this phase; only the pre-existing spec lacks it.
