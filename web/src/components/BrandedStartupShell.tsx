import './BrandedStartupShell.css'

type BrandedStartupShellProps={
 message:string
 brand?:string
}

/**
 * Stable, dependency-free startup surface shared by bundle and session loading.
 * All artwork is solid DOM/CSS so it is visible before WebGL is available.
 */
export function BrandedStartupShell({message,brand='LingoLife'}:BrandedStartupShellProps){
 return <main className="branded-startup" role="status" aria-live="polite" aria-busy="true">
  <div className="branded-startup__sky" aria-hidden>
   <i className="branded-startup__star branded-startup__star--one"/>
   <i className="branded-startup__star branded-startup__star--two"/>
   <i className="branded-startup__star branded-startup__star--three"/>
   <span className="branded-startup__cloud branded-startup__cloud--left"><i/><i/><i/></span>
   <span className="branded-startup__cloud branded-startup__cloud--right"><i/><i/><i/></span>
   <span className="branded-startup__cloud branded-startup__cloud--far"><i/><i/><i/></span>
   <div className="branded-startup__cloud-bank">
    <i/><i/><i/><i/><i/><i/>
   </div>
  </div>

  <section className="branded-startup__brand" aria-label={`${brand} · ${message}`}>
   <div className="branded-startup__logo" aria-hidden>
    <span className="branded-startup__sun"/>
    <span className="branded-startup__city">
     <i/><i/><i/>
    </span>
    <span className="branded-startup__road"/>
   </div>
   <p className="branded-startup__wordmark">{brand}</p>
   <p className="branded-startup__message">{message}</p>
   <span className="branded-startup__progress" aria-hidden><i/><i/><i/></span>
  </section>
 </main>
}

export default BrandedStartupShell
