export interface CheckerResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

export interface DesignContractFixture {
  root: string;
  cleanup: () => void;
}

export function runDesignContractChecker(root?: string): CheckerResult;
export function createYamlMarkerFixture(): DesignContractFixture;
