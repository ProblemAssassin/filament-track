// UI audit only: exercise save/continue without requesting access to a real camera.
import {LabelScanner as RealScanner} from '/__real_scanner.js';
export class LabelScanner extends RealScanner{async start(){await this.stop();this.onCamera(false);this.progress('QA camera stub. Use a label photo to test recognition without accessing a physical camera.');}}
