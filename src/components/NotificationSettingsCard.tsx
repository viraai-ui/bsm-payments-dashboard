'use client'

export function NotificationSettingsCard() {
  return <div className="settings-list-card notification-settings-card">
    <div className="settings-list-head">
      <div><h3>Device notifications</h3><p>Enable payment updates on this device, or review blocked and unsupported states.</p></div>
      <button className="btn notification-settings-button" type="button" onClick={() => window.dispatchEvent(new Event('payment-notifications:settings'))}>Enable notifications</button>
    </div>
  </div>
}
