const Ably = require('ably');

// Test Ably connection
async function testAblyConnection() {
  console.log('🧪 Testing Ably Connection...');
  
  try {
    // Initialize Ably with your API key
    const ably = new Ably.Rest({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    });

    console.log('✅ Ably REST client initialized successfully');

    // Test publishing a message
    const testChannel = ably.channels.get('test-channel');
    console.log('📡 Publishing test message...');
    
    await testChannel.publish('test-event', {
      message: 'Hello from Ably!',
      timestamp: new Date().toISOString(),
      test: true
    });

    console.log('✅ Message published successfully!');

    // Test getting channel history
    console.log('📚 Getting channel history...');
    const history = await testChannel.history();
    console.log(`✅ Channel history retrieved. Found ${history.items.length} messages`);

    // Test presence
    console.log('👥 Testing presence...');
    const presence = await testChannel.presence.get();
    console.log(`✅ Presence retrieved. Found ${presence.length} members`);

    console.log('🎉 All Ably tests passed!');
    return true;

  } catch (error) {
    console.error('❌ Ably test failed:', error);
    console.error('Error details:', error.message);
    return false;
  }
}

// Test real-time connection
function testRealtimeConnection() {
  console.log('🔄 Testing Ably Realtime Connection...');
  
  return new Promise((resolve) => {
    const ably = new Ably.Realtime({
      key: 'E_U1fw.iYMzEg:KNoWxsCQgLnZ9_oeCL3VWU0NUD3wUB_nbO2rVez2WnA'
    });

    ably.connection.on('connected', () => {
      console.log('✅ Realtime connection established!');
      console.log('Connection ID:', ably.connection.id);
      console.log('Client ID:', ably.auth.clientId);
      
      // Test subscribing to a channel
      const channel = ably.channels.get('test-realtime');
      
      channel.subscribe('test', (message) => {
        console.log('📨 Received message:', message.data);
      });

      // Publish a test message
      channel.publish('test', {
        message: 'Hello from realtime!',
        timestamp: new Date().toISOString()
      });

      setTimeout(() => {
        ably.close();
        console.log('🔒 Realtime connection closed');
        resolve(true);
      }, 2000);
    });

    ably.connection.on('failed', (error) => {
      console.error('❌ Realtime connection failed:', error);
      resolve(false);
    });

    ably.connection.on('disconnected', () => {
      console.log('🔌 Realtime connection disconnected');
    });
  });
}

// Run tests
async function runTests() {
  console.log('🚀 Starting Ably Connection Tests...\n');
  
  // Test REST API
  const restTest = await testAblyConnection();
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test Realtime API
  const realtimeTest = await testRealtimeConnection();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Results:');
  console.log(`REST API: ${restTest ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Realtime API: ${realtimeTest ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (restTest && realtimeTest) {
    console.log('🎉 All tests passed! Ably is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Please check your API key and network connection.');
  }
}

// Run the tests
runTests().catch(console.error); 