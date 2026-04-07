// Cross call arrow binding helper.
//
// Why this exists:
//   `convertToExcalidrawElements` only resolves arrow start/end ids against
//   elements in its OWN input batch. When the agent splits a diagram across
//   multiple addElements calls (rectangles in call 1, arrows in call 2), the
//   second call's arrows reference shapes from the first call. The helper
//   drops the bindings and logs "No element for start binding with id rect_X
//   found." Result: unbound arrows on the canvas and a broken looking diagram.
//
//   The system prompt promises the model that arrow start/end ids can
//   reference shapes "in this call OR already on the canvas." This helper
//   makes that promise honest by patching the runtime arrows after the
//   skeleton helper runs.
//
// What this file does:
//   `applyCrossCallBindings(skeletons, runtime, existingScene)` walks the
//   skeleton input, finds arrows whose start/end ids reference an element on
//   the existing canvas, and patches the matching runtime arrow with
//   startBinding / endBinding. Also returns the patched existing elements
//   with updated boundElements so Excalidraw's bidirectional binding tracking
//   sees the new arrows.
//
// This is shipped pre built on the lesson 8 branch. Students do not write it
// during the workshop. The interesting code is in `applySkeleton.ts` and the
// noOverlaps scorer; this is just plumbing around an Excalidraw helper
// limitation.

interface SkeletonLike {
  type?: unknown;
  id?: unknown;
  start?: unknown;
  end?: unknown;
}

interface RuntimeLike {
  id: string;
  startBinding?: unknown;
  endBinding?: unknown;
}

interface ExistingLike {
  id: string;
  boundElements?: readonly { id: string; type: string }[] | null;
}

export interface CrossCallBindingResult<T extends ExistingLike> {
  // Per existing element id, the list of new arrow ids that now bind to it.
  // The caller uses this to update boundElements via newElementWith.
  arrowsByTargetId: Map<string, string[]>;
  // Set of existing element ids that gained new bound arrows.
  patchedTargetIds: Set<string>;
}

// Patch new runtime arrows in place so their startBinding / endBinding point
// at existing canvas elements when their skeleton inputs reference those
// elements by id. Returns the metadata the caller needs to update
// boundElements on the affected existing elements.
export function applyCrossCallBindings<T extends ExistingLike>(
  skeletons: SkeletonLike[],
  runtime: RuntimeLike[],
  existingScene: readonly T[]
): CrossCallBindingResult<T> {
  const existingIds = new Set(existingScene.map((el) => el.id));
  const runtimeById = new Map(runtime.map((el) => [el.id, el]));
  const arrowsByTargetId = new Map<string, string[]>();

  for (const skeleton of skeletons) {
    if (skeleton.type !== "arrow" && skeleton.type !== "line") continue;
    if (typeof skeleton.id !== "string") continue;
    const arrow = runtimeById.get(skeleton.id);
    if (!arrow) continue;

    const startId = (skeleton.start as { id?: unknown } | undefined)?.id;
    if (
      typeof startId === "string" &&
      existingIds.has(startId) &&
      !arrow.startBinding
    ) {
      (arrow as { startBinding: unknown }).startBinding = {
        elementId: startId,
        focus: 0,
        gap: 8,
      };
      const list = arrowsByTargetId.get(startId) ?? [];
      list.push(skeleton.id);
      arrowsByTargetId.set(startId, list);
    }

    const endId = (skeleton.end as { id?: unknown } | undefined)?.id;
    if (
      typeof endId === "string" &&
      existingIds.has(endId) &&
      !arrow.endBinding
    ) {
      (arrow as { endBinding: unknown }).endBinding = {
        elementId: endId,
        focus: 0,
        gap: 8,
      };
      const list = arrowsByTargetId.get(endId) ?? [];
      list.push(skeleton.id);
      arrowsByTargetId.set(endId, list);
    }
  }

  return {
    arrowsByTargetId,
    patchedTargetIds: new Set(arrowsByTargetId.keys()),
  };
}

// Compute the new boundElements list for an existing element. Used by the
// caller after applyCrossCallBindings, in tandem with `newElementWith` to
// produce the patched runtime element.
export function mergeBoundElements(
  existing: ExistingLike,
  incomingArrowIds: string[]
): { id: string; type: string }[] {
  const prev = (existing.boundElements ?? []) as readonly { id: string; type: string }[];
  return [
    ...prev,
    ...incomingArrowIds
      .filter((id) => !prev.some((b) => b.id === id))
      .map((id) => ({ id, type: "arrow" })),
  ];
}
