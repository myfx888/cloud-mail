<?php
header('Content-Type: application/json');

$apiUrl = $_POST['apiUrl'] ?? '';
$apiKey = $_POST['apiKey'] ?? '';
$endpoint = $_POST['endpoint'] ?? '';
$method = $_POST['method'] ?? 'GET';
$data = $_POST['data'] ?? null;

if (empty($apiUrl) || empty($apiKey) || empty($endpoint)) {
    echo json_encode(['error' => 'Missing required parameters']);
    exit;
}

// Normalize API URL
$apiUrl = rtrim($apiUrl, '/');
if (strtolower(substr($apiUrl, -7)) === '/api/v1') {
    $apiUrl = substr($apiUrl, 0, -7);
    $apiUrl = rtrim($apiUrl, '/');
}

$url = $apiUrl . '/api/v1/' . $endpoint;

$ch = curl_init($url);

$headers = [
    'X-API-Key: ' . $apiKey,
    'Content-Type: application/json'
];

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For local/private certs if needed

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    $postData = $_POST['data'] ?? null;
    if ($postData) {
        // If it's already a JSON string, use it directly, otherwise encode it
        $payload = is_string($postData) && is_array(json_decode($postData, true)) 
            ? $postData 
            : json_encode($postData);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    }
}

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

curl_close($ch);

if ($error) {
    echo json_encode([
        'success' => false,
        'error' => 'cURL Error: ' . $error,
        'url' => $url
    ]);
} else {
    echo json_encode([
        'success' => $httpCode >= 200 && $httpCode < 300,
        'status' => $httpCode,
        'content_type' => $contentType,
        'body' => $response,
        'url' => $url
    ]);
}
