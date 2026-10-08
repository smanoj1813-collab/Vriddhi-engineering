// Imported first from index.ts so it applies to every function defined later.
// New Firebase projects get a 20 vCPU per-region Cloud Run quota; the v2
// default of 100 max instances (x 1 vCPU) is rejected at deploy time.
import { setGlobalOptions } from 'firebase-functions/v2'

setGlobalOptions({ maxInstances: 10 })
