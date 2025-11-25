import { createWorkerConfig } from '../../config/vite/worker.config';

export default createWorkerConfig({
  workerName: 'ecom-api',
  additionalExternals: ['stripe'],
});
