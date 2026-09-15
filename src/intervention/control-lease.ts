export type Controller = "automation" | "human";

export interface ControlLeaseState {
  controller: Controller;
  epoch: number;
}

export class ControlLease {
  #state: ControlLeaseState = { controller: "automation", epoch: 0 };

  public current(): ControlLeaseState {
    return { ...this.#state };
  }

  public transfer(expected: Controller, next: Controller): ControlLeaseState {
    if (this.#state.controller !== expected) {
      throw new Error(
        `Control is owned by ${this.#state.controller}, not ${expected}`,
      );
    }

    if (expected === next) {
      throw new Error(`Control is already owned by ${next}`);
    }

    this.#state = { controller: next, epoch: this.#state.epoch + 1 };
    return this.current();
  }
}
