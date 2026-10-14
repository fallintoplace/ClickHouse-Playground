import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SelectControl } from '../../../src/frontend/ui/components/SelectControl.js';

const options = Array.from({ length: 60 }, (_, index) => ({
    value: String(index),
    label: `second_value_${String(index).padStart(2, '0')}_${'long_column_name_'.repeat(4)}`,
    disabled: index % 7 === 0,
}));

function Harness() {
    const [value, setValue] = useState('59');
    return (
        <SelectControl
            className="select-control-field"
            label="Map second_value to destination"
            value={value}
            options={options}
            onChange={setValue}
            searchable={new URLSearchParams(location.search).get('searchable') !== 'false'}
        />
    );
}

createRoot(document.getElementById('select-harness')!).render(<Harness />);
