import {
  scheduleGeneratedArtifactsDelete,
  scheduleGeneratedArtifactsRefresh,
} from '../core/generatedArtifacts';

interface WriteArtifactPath {
  domain: string;
  path: string;
}

interface MovedChildPathRow {
  path: string;
}

export function scheduleWriteArtifactsRefresh(path: WriteArtifactPath): void {
  scheduleGeneratedArtifactsRefresh([path]);
}

export function scheduleWriteArtifactsDelete(path: WriteArtifactPath): void {
  scheduleGeneratedArtifactsDelete([path]);
}

export function scheduleWriteArtifactsAfterMove(
  previous: WriteArtifactPath,
  next: WriteArtifactPath,
  movedChildren: MovedChildPathRow[],
): void {
  scheduleGeneratedArtifactsDelete([previous]);
  scheduleGeneratedArtifactsRefresh([
    next,
    ...movedChildren.map((row) => ({ domain: next.domain, path: row.path })),
  ]);
}
