"""Run with Python and Node.js installed: python notebooks/test_notebook.py."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import unquote


class NotebookInputsTest(unittest.TestCase):
    def test_input_cell_recomputes_result_sequences_export_and_link(self):
        notebook = json.loads(Path(__file__).with_name('QKD_Colab_Demonstration.ipynb').read_text(encoding='utf-8'))
        code = [''.join(c['source']) for c in notebook['cells'] if c['cell_type'] == 'code']
        previous = Path.cwd()
        temporary = tempfile.TemporaryDirectory()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                os.chdir(temporary.name)
                scope = {}
                exec(code[0], scope)
                exec(code[1], scope)
                baseline = scope['result']
                self.assertEqual(baseline['finalBits'], 649)
                for replacements, expected in [
                    ([('noise = 0.05', 'noise = 0.15')], {'noise': .15, 'protocol': 'BB84'}),
                    ([('seed = 42', 'seed = 43')], {'seed': 43, 'protocol': 'BB84'}),
                    ([('protocol = "BB84"', 'protocol = "B92"'), ('pulses = 10000', 'pulses = 100000'), ('noise = 0.05', 'noise = 0.005')], {'protocol': 'B92', 'pulses': 100000, 'noise': .005}),
                ]:
                    source = code[1]
                    for old, new in replacements:
                        self.assertIn(old, source)
                        source = source.replace(old, new, 1)
                    exec(source, scope)
                    result = scope['result']
                    linked = json.loads(unquote(scope['dashboard_link'].split('#qkd=', 1)[1]))
                    exported = json.loads(Path('qkd-colab-result.json').read_text(encoding='utf-8'))
                    for key, value in expected.items():
                        self.assertEqual(result['config'][key], value)
                        self.assertEqual(linked[key], value)
                        self.assertEqual(exported['config'][key], value)
                    self.assertEqual(scope['preview'], result['audit'][:32])
                    self.assertNotEqual(result, baseline)
                    self.assertEqual(scope['kept_count'] + scope['discarded_count'] + scope['lost_count'], 32)
                self.assertEqual(scope['result']['finalBits'], 8777)
        finally:
            os.chdir(previous)
            temporary.cleanup()


if __name__ == '__main__':
    unittest.main()
