import type { JSX } from 'react';

import ModelWorkspace from '@/features/models/ModelWorkspace';

export default function InferenceEnginePage(): JSX.Element {
  return <ModelWorkspace view="inference" />;
}
