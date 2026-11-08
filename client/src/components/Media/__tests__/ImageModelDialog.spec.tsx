import { render, screen, fireEvent } from '@testing-library/react';
import type { TMediaImageModel } from 'librechat-data-provider';
import ImageModelDialog, { filterImageModels } from '../ImageModelDialog';

let mockStatus: Record<string, unknown>;
jest.mock('~/data-provider', () => ({ useMediaStatusQuery: () => mockStatus }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/hooks/useBalanceSummary', () => ({
  useBalanceDisplay: () => ({ display: 'credits', currency: undefined }),
}));

const models: TMediaImageModel[] = [
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    persianText: true,
    estimateUsd: 0.06,
    default: true,
  },
  { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', persianText: false, estimateUsd: 0.1 },
  { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max', persianText: false, estimateUsd: 0.2 },
];

describe('filterImageModels', () => {
  it('matches every word against the id and name, and «فارسی» against the marked models', () => {
    expect(filterImageModels(models, 'flux max').map((model) => model.id)).toEqual([
      'black-forest-labs/flux.2-max',
    ]);
    expect(filterImageModels(models, 'black forest')).toHaveLength(2);
    expect(filterImageModels(models, 'فارسی').map((model) => model.id)).toEqual([
      'openai/gpt-image-2',
    ]);
    expect(filterImageModels(models, '')).toHaveLength(3);
  });
});

describe('ImageModelDialog', () => {
  const renderDialog = (onPick = jest.fn(), onOpenChange = jest.fn()) => {
    render(
      <ImageModelDialog
        open
        onOpenChange={onOpenChange}
        current="openai/gpt-image-2"
        onPick={onPick}
      />,
    );
    return { onPick, onOpenChange };
  };

  it('lists the Persian-text models first, marks the current one, and picks on click', () => {
    mockStatus = { data: { imageModels: models }, isSuccess: true };
    const { onPick, onOpenChange } = renderDialog();
    expect(screen.getByText('com_media_image_model_group_persian')).toBeInTheDocument();
    expect(screen.getByTestId('image-model-openai/gpt-image-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByTestId('image-model-black-forest-labs/flux.2-max'));
    expect(onPick).toHaveBeenCalledWith('black-forest-labs/flux.2-max');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('filters as the user types and says when nothing matches', () => {
    mockStatus = { data: { imageModels: models }, isSuccess: true };
    renderDialog();
    const search = screen.getByLabelText('com_media_image_model_search');
    fireEvent.change(search, { target: { value: 'max' } });
    expect(screen.queryByTestId('image-model-openai/gpt-image-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-model-black-forest-labs/flux.2-max')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'midjourney' } });
    expect(screen.getByText('com_media_image_model_none')).toBeInTheDocument();
  });

  it('offers a retry when the list cannot load', () => {
    mockStatus = { data: undefined, isError: true, refetch: jest.fn() };
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('com_media_tools_error');
    expect(screen.getByRole('button', { name: 'com_ui_retry' })).toBeInTheDocument();
  });
});
