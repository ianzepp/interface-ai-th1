/**
 * Who is driving the live session.
 *
 * Automation and a human share one browser session, so control has to be
 * explicit rather than implied. The lease is a compare-and-swap: a caller must
 * state which controller it believes holds the session, which stops a resumed
 * automation loop from writing over a person who is still working. The epoch
 * increments on every transfer so a holder that was displaced can be detected
 * after the fact.
 *
 * This type models ownership only. What a paused run does next lives in
 * `request`, and whether the session is safe to continue from lives in
 * `resume`.
 */

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

  /**
   * Hand control from `expected` to `next`.
   *
   * Both failures are deliberate. Transferring from the wrong holder means the
   * caller's view of the session is stale, and transferring to the holder that
   * already owns control is a no-op that would inflate the epoch and mask that
   * staleness.
   */
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
