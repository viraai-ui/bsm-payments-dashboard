import './loading.css'

export default function OverviewLoading(){
  return <main className="overview-loading" aria-label="Loading overview" aria-busy="true">
    <header><span className="loading-block loading-title"/><span className="loading-block loading-period"/></header>
    <section className="loading-cards"><span/><span/><span/></section>
    <section className="loading-analysis"><span/><span/></section>
    <section className="loading-lists"><span/><span/></section>
  </main>
}
