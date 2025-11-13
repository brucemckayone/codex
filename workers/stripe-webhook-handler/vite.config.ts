import { createWorkerConfig } from '../../config/vite/worker.config';

export default createWorkerConfig({
  workerName: 'stripe-webhook-handler',
  additionalExternals: ['stripe'],
});
