import { render, screen } from '@testing-library/react';
import Prices from '../Prices';

const packs = [
  { id: 'starter', label: 'Starter', credits: 2_000_000 },
  { id: 'pro', label: 'Pro', credits: 15_000_000 },
];
const toman = { code: 'IRT', rate: 269_500, priceStep: 1000 };

describe('balance Prices', () => {
  it('lists every pack with its Toman price', () => {
    render(<Prices packs={packs} currency={toman} />);
    expect(screen.getByRole('heading', { name: 'Pack prices' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Starter');
    expect(items[0]).toHaveTextContent('۵۳۹٬۰۰۰ تومان');
    expect(items[1]).toHaveTextContent('۴٬۰۴۳٬۰۰۰ تومان');
  });

  it('links to the purchase page when one is configured', () => {
    render(<Prices packs={packs} currency={toman} purchaseUrl="https://t.me/support" />);
    expect(screen.getByRole('link', { name: 'Buy a pack' })).toHaveAttribute(
      'href',
      'https://t.me/support',
    );
  });

  it('renders nothing without a currency to price in', () => {
    const { container } = render(<Prices packs={packs} />);
    expect(container).toBeEmptyDOMElement();
  });
});
