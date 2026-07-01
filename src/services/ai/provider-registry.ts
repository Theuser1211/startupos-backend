import { AIProvider } from "../../types/ai.js";
import { logger } from "../../lib/logger.js";

export interface ProviderRegistration {
  id: string;
  provider: string;
  model: string;
  priority: number;
  apiKey: string;
  status: "healthy" | "cooldown";
  cooldownUntil: number | null;
  requestCount: number;
  failureCount: number;
  lastFailure: number | null;
  totalDurationMs: number;
  createProvider: () => AIProvider;
}

export interface ProviderHealth {
  id: string;
  provider: string;
  model: string;
  priority: number;
  status: "healthy" | "cooldown";
  requestCount: number;
  failureCount: number;
  cooldownRemaining: number;
  avgLatencyMs: number;
}

const COOLDOWN_MS = 15 * 60 * 1000;

export class ProviderRegistry {
  private entries: Map<string, ProviderRegistration> = new Map();
  private priorityGroups: ProviderRegistration[][] = [];
  private roundRobinCounters: number[] = [];
  private consecutiveFailures: Map<string, number> = new Map();

  register(registration: {
    id: string;
    provider: string;
    model: string;
    priority: number;
    apiKey: string;
    createProvider: () => AIProvider;
  }): void {
    this.staleGroups = true;
    this.entries.set(registration.id, {
      ...registration,
      status: "healthy",
      cooldownUntil: null,
      requestCount: 0,
      failureCount: 0,
      lastFailure: null,
      totalDurationMs: 0,
      createProvider: registration.createProvider,
    });
  }

  private staleGroups = true;

  private rebuildPriorityGroups(): void {
    if (!this.staleGroups) return;
    const grouped = new Map<number, ProviderRegistration[]>();
    for (const entry of this.entries.values()) {
      const group = grouped.get(entry.priority) || [];
      group.push(entry);
      grouped.set(entry.priority, group);
    }
    const sortedPriorities = Array.from(grouped.keys()).sort((a, b) => a - b);
    this.priorityGroups = sortedPriorities.map((p) => grouped.get(p)!);
    while (this.roundRobinCounters.length < this.priorityGroups.length) {
      this.roundRobinCounters.push(0);
    }
    this.staleGroups = false;
  }

  private isInCooldown(entry: ProviderRegistration): boolean {
    if (entry.status !== "cooldown" || entry.cooldownUntil === null) {
      return false;
    }
    if (Date.now() >= entry.cooldownUntil) {
      entry.status = "healthy";
      entry.cooldownUntil = null;
      logger.info({ providerId: entry.id, provider: entry.provider }, "Provider recovered from cooldown");
      return false;
    }
    return true;
  }

  getNextAvailableProvider(): ProviderRegistration | null {
    this.rebuildPriorityGroups();

    for (let tierIdx = 0; tierIdx < this.priorityGroups.length; tierIdx++) {
      const tier = this.priorityGroups[tierIdx];
      const available = tier.filter((e) => !this.isInCooldown(e));

      if (available.length === 0) continue;

      const counter = this.roundRobinCounters[tierIdx];
      const selected = available[counter % available.length];
      this.roundRobinCounters[tierIdx] = (counter + 1) % available.length;

      return selected;
    }

    return null;
  }

  recordSuccess(id: string, durationMs: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    entry.requestCount++;
    entry.totalDurationMs += durationMs;
    this.consecutiveFailures.set(id, 0);

    if (entry.status === "cooldown" && entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
      entry.status = "healthy";
      entry.cooldownUntil = null;
      logger.info({ providerId: id, provider: entry.provider }, "Provider recovered from cooldown");
    }
  }

  recordFailure(id: string, statusCode: number, durationMs: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    entry.requestCount++;
    entry.failureCount++;
    entry.lastFailure = Date.now();
    entry.totalDurationMs += durationMs;

    const prev = this.consecutiveFailures.get(id) || 0;
    const next = prev + 1;
    this.consecutiveFailures.set(id, next);

    const shouldCooldown =
      statusCode === 429 ||
      (statusCode >= 500 && next >= 2) ||
      (statusCode === 0 && next >= 2);

    if (shouldCooldown) {
      entry.status = "cooldown";
      entry.cooldownUntil = Date.now() + COOLDOWN_MS;
      logger.warn(
        {
          providerId: id,
          provider: entry.provider,
          statusCode,
          consecutiveFailures: next,
          cooldownMs: COOLDOWN_MS,
        },
        "Provider cooldown started",
      );
    }
  }

  getHealth(): ProviderHealth[] {
    const result: ProviderHealth[] = [];
    for (const entry of this.entries.values()) {
      const inCooldown = this.isInCooldown(entry);
      const avgLatencyMs =
        entry.requestCount > 0
          ? Math.round(entry.totalDurationMs / entry.requestCount)
          : 0;

      result.push({
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        priority: entry.priority,
        status: inCooldown ? "cooldown" : "healthy",
        requestCount: entry.requestCount,
        failureCount: entry.failureCount,
        cooldownRemaining:
          inCooldown && entry.cooldownUntil
            ? Math.max(0, entry.cooldownUntil - Date.now())
            : 0,
        avgLatencyMs,
      });
    }
    return result.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  getEntryCount(): number {
    return this.entries.size;
  }

  getEntry(id: string): ProviderRegistration | undefined {
    return this.entries.get(id);
  }
}

export const providerRegistry = new ProviderRegistry();
