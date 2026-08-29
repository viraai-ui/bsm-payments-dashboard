'use client'

import Image from 'next/image'

const providers = [
  {
    key: 'rapido',
    name: 'Rapido',
    url: 'https://www.rapido.bike/Home',
    logoSrc: '/vehicle-logos/rapido.jpg',
    accent: 'rapido',
    button: 'Open Rapido',
  },
  {
    key: 'porter',
    name: 'Porter',
    url: 'https://porter.in/enterprise',
    logoSrc: '/vehicle-logos/porter.jpg',
    accent: 'porter',
    button: 'Open Porter',
  },
]

export function VehicleLauncherClient() {
  return <section className="vehicle-provider-grid" aria-label="Vehicle booking applications">
    {providers.map((provider) => <article className={`vehicle-provider-card ${provider.accent}`} key={provider.key}>
      <a className="vehicle-logo-link" href={provider.url} target="_blank" rel="noreferrer" aria-label={`Open ${provider.name}`}>
        <Image className="vehicle-logo-img" src={provider.logoSrc} width={220} height={220} alt={`${provider.name} logo`} priority />
      </a>
      <div className="vehicle-provider-copy">
        <h2>{provider.name}</h2>
      </div>
      <a className="btn red vehicle-open-btn" href={provider.url} target="_blank" rel="noreferrer">{provider.button}</a>
    </article>)}
  </section>
}
