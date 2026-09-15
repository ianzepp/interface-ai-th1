import type {
  ActionResult,
  Observation,
  SurfaceAction,
} from "../surfaces/surface-driver.js";

export type DiscoveryEvent =
  | {
      type: "observation";
      recordedAt: string;
      observation: Observation;
    }
  | {
      type: "action";
      recordedAt: string;
      action: SurfaceAction;
      result: ActionResult;
      rationale: string;
    }
  | {
      type: "checkpoint";
      recordedAt: string;
      name: string;
      satisfied: boolean;
    };

export interface EventRecorder {
  append(event: DiscoveryEvent): Promise<void>;
  readAll(): Promise<readonly DiscoveryEvent[]>;
}

export class InMemoryEventRecorder implements EventRecorder {
  readonly #events: DiscoveryEvent[] = [];

  public append(event: DiscoveryEvent): Promise<void> {
    this.#events.push(event);
    return Promise.resolve();
  }

  public readAll(): Promise<readonly DiscoveryEvent[]> {
    return Promise.resolve([...this.#events]);
  }
}
