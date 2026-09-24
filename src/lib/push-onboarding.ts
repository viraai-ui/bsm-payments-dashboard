export const PUSH_ONBOARDING_CAMPAIGN = 'push-onboarding-v2'
export type PushOnboardingDecision = 'hidden' | 'prompt' | 'reconnect' | 'blocked' | 'ios-install'

export type PushOnboardingFacts = {
  supported: boolean
  ios: boolean
  standalone: boolean
  permission: NotificationPermission
  dismissed: boolean
  hasSubscription: boolean
  serverVerified: boolean
}

/** Pure campaign policy, kept separate so browser/role regressions can exercise it. */
export function decidePushOnboarding(facts: PushOnboardingFacts): PushOnboardingDecision {
  if (!facts.supported || facts.dismissed || facts.serverVerified) return 'hidden'
  if (facts.ios && !facts.standalone) return 'ios-install'
  if (facts.permission === 'denied') return 'blocked'
  if (facts.permission === 'granted' && facts.hasSubscription) return 'reconnect'
  return 'prompt'
}

export function pushOnboardingKey(userId: string, deviceId: string) {
  return `payment-push-onboarding:${PUSH_ONBOARDING_CAMPAIGN}:${userId}:${deviceId}`
}
