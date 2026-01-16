import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Import functions to test
# Since we are running with uv, we might need to adjust paths or imports
# For simplicity, we'll mock the external dependencies

class TestVisualObserverBase(unittest.TestCase):
    def test_detect_media_indicators(self):
        from visual_observer_base import detect_media_indicators
        
        self.assertIn("youtube", detect_media_indicators("Watching a youtube video"))
        self.assertIn("image-file", detect_media_indicators("screenshot.png"))
        self.assertEqual([], detect_media_indicators("Just some text"))

    def test_infer_label_mapping(self):
        # Verify our label map matches our category list
        from visual_observer_base import UI_CATEGORIES, CATEGORY_LABELS
        self.assertEqual(len(UI_CATEGORIES), len(CATEGORY_LABELS))

class TestVisualObserverDescribe(unittest.TestCase):
    @patch('requests.post')
    def test_call_ollama_vision_batch(self, mock_post):
        from visual_observer_describe import call_ollama_vision_batch
        
        # Mock successful Ollama response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "message": {
                "content": json.dumps({
                    "descriptions": [
                        {"index": 0, "summary": "test description"}
                    ]
                })
            }
        }
        mock_post.return_value = mock_response
        
        # We need to mock image_to_base64 too because it reads files
        with patch('visual_observer_describe.image_to_base64', return_value="data:image/jpeg;base64,abc"):
            images = [{"clusterId": 1, "timestamp": 0, "imagePath": "test.jpg"}]
            results = call_ollama_vision_batch(images, "test-model")
            
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["description"], "test description")
            self.assertEqual(results[0]["clusterId"], 1)

if __name__ == '__main__':
    unittest.main()
