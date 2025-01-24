import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import { useState, useEffect } from 'react';
import Voice, { SpeechResultsEvent } from '@react-native-voice/voice';

// 한글 자음/모음 가중치 설정
const CONSONANT_WEIGHT = 1.5;  // 자음은 더 중요하게 취급
const VOWEL_WEIGHT = 1.0;     // 모음은 기본 가중치
const FINAL_CONSONANT_WEIGHT = 1.2;  // 받침은 중간 가중치

// 자모 분리 함수 개선
const separateHangul = (char: string) => {
  const charCode = char.charCodeAt(0) - 0xAC00;
  if (charCode < 0 || charCode > 11171) return char;
  
  const jong = charCode % 28;
  const jung = ((charCode - jong) / 28) % 21;
  const cho = (((charCode - jong) / 28) - jung) / 21;
  
  return {
    cho: String.fromCharCode(0x1100 + cho),
    jung: String.fromCharCode(0x1161 + jung),
    jong: jong ? String.fromCharCode(0x11A7 + jong) : ''
  };
};

// 자음/모음 분류 함수
const isConsonant = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (code >= 0x1100 && code <= 0x1112);
};

const isVowel = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (code >= 0x1161 && code <= 0x1175);
};

const isFinalConsonant = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (code >= 0x11A8 && code <= 0x11C2);
};

// 유사 발음 그룹 타입 정의
type ConsonantMap = {
  [key: string]: string[];
};

// 유사 발음 그룹 정의
const SIMILAR_CONSONANTS: ConsonantMap = {
  'ㄱ': ['ㅋ'],
  'ㅋ': ['ㄱ'],
  'ㄷ': ['ㅌ'],
  'ㅌ': ['ㄷ'],
  'ㅂ': ['ㅍ'],
  'ㅍ': ['ㅂ'],
  'ㅈ': ['ㅊ'],
  'ㅊ': ['ㅈ'],
};

// 초성 매핑 타입 정의
type ChoseongMap = {
  [key: string]: string;
};

// 초성 매핑
const CHOSEONG_MAP: ChoseongMap = {
  'ᄀ': 'ㄱ', 'ᄁ': 'ㄲ', 'ᄂ': 'ㄴ', 'ᄃ': 'ㄷ', 'ᄄ': 'ㄸ',
  'ᄅ': 'ㄹ', 'ᄆ': 'ㅁ', 'ᄇ': 'ㅂ', 'ᄈ': 'ㅃ', 'ᄉ': 'ㅅ',
  'ᄊ': 'ㅆ', 'ᄋ': 'ㅇ', 'ᄌ': 'ㅈ', 'ᄍ': 'ㅉ', 'ᄎ': 'ㅊ',
  'ᄏ': 'ㅋ', 'ᄐ': 'ㅌ', 'ᄑ': 'ㅍ', 'ᄒ': 'ㅎ'
};

// 유사 자음 체크 함수
const isSimilarConsonant = (char1: string, char2: string): boolean => {
  const c1 = CHOSEONG_MAP[char1] || char1;
  const c2 = CHOSEONG_MAP[char2] || char2;
  
  return Boolean(
    (SIMILAR_CONSONANTS[c1]?.includes(c2)) || 
    (SIMILAR_CONSONANTS[c2]?.includes(c1)) || 
    c1 === c2
  );
};

// 가중치가 적용된 레벤슈타인 거리 계산 함수 수정
const weightedLevenshteinDistance = (a: string[], b: string[]): number => {
  const matrix: number[][] = [];
  
  // 행렬 초기화
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  // 가중치를 적용한 거리 계산
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        let weight = 1;
        
        // 자음인 경우 유사 발음 체크
        if (isConsonant(a[j - 1]) && isConsonant(b[i - 1])) {
          if (isSimilarConsonant(a[j - 1], b[i - 1])) {
            // 유사 발음인 경우 페널티 감소
            weight = CONSONANT_WEIGHT * 0.5;  // 50% 감소된 페널티
          } else {
            weight = CONSONANT_WEIGHT;
          }
        } else if (isVowel(a[j - 1]) || isVowel(b[i - 1])) {
          weight = VOWEL_WEIGHT;
        } else if (isFinalConsonant(a[j - 1]) || isFinalConsonant(b[i - 1])) {
          // 받침의 경우도 유사 발음 체크
          if (isFinalConsonant(a[j - 1]) && isFinalConsonant(b[i - 1]) &&
              isSimilarConsonant(a[j - 1], b[i - 1])) {
            weight = FINAL_CONSONANT_WEIGHT * 0.5;
          } else {
            weight = FINAL_CONSONANT_WEIGHT;
          }
        }
        
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + weight,  // 대체
          matrix[i][j - 1] + weight,      // 삽입
          matrix[i - 1][j] + weight       // 삭제
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
};

// 유사도 점수 계산 함수에 보너스 점수 로직 추가
const calculateSimilarity = (target: string, input: string): number => {
  // 각 글자를 자모 단위로 분리
  const targetJamo = Array.from(target).map(separateHangul);
  const inputJamo = Array.from(input).map(separateHangul);
  
  // 자모 배열 생성
  const targetArray: string[] = [];
  const inputArray: string[] = [];
  
  // 분리된 자모를 배열로 변환
  targetJamo.forEach(char => {
    if (typeof char === 'object') {
      targetArray.push(char.cho, char.jung);
      if (char.jong) targetArray.push(char.jong);
    } else {
      targetArray.push(char);
    }
  });
  
  inputJamo.forEach(char => {
    if (typeof char === 'object') {
      inputArray.push(char.cho, char.jung);
      if (char.jong) inputArray.push(char.jong);
    } else {
      inputArray.push(char);
    }
  });
  
  // 가중치가 적용된 레벤슈타인 거리 계산
  const distance = weightedLevenshteinDistance(targetArray, inputArray);
  
  // 최대 거리 계산 (가중치 고려)
  const maxLength = Math.max(targetArray.length, inputArray.length);
  const maxDistance = maxLength * CONSONANT_WEIGHT; // 최악의 경우 모든 자음이 틀린 경우
  
  // 유사도 점수 계산 (100점 만점)
  const similarity = Math.max(0, ((maxDistance - distance) / maxDistance) * 100);
  
  // 점수 보정: 길이 차이가 많이 나는 경우 페널티 부여
  const lengthDiffPenalty = Math.abs(targetArray.length - inputArray.length) * 5;
  
  // 유사 발음 보너스 계산
  let similarConsonantBonus = 0;
  for (let i = 0; i < Math.min(targetArray.length, inputArray.length); i++) {
    if (isConsonant(targetArray[i]) && isConsonant(inputArray[i])) {
      if (isSimilarConsonant(targetArray[i], inputArray[i]) && 
          targetArray[i] !== inputArray[i]) {
        similarConsonantBonus += 2; // 유사 발음당 2점 보너스
      }
    }
  }
  
  const finalScore = Math.max(0, 
    Math.min(100, similarity - lengthDiffPenalty + similarConsonantBonus)
  );
  
  return Math.round(finalScore);
};

const App: React.FC = () => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState<string>('');
  const [isListening, setIsListening] = useState(false);
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const targetWord = "안녕하세요";

  useEffect(() => {
    Voice.onSpeechStart = () => {
      console.log('음성 인식 시작됨');
      setError(null);
    };
    
    Voice.onSpeechEnd = () => {
      console.log('음성 인식 종료됨');
    };
    
    Voice.onSpeechResults = onSpeechResults;
    
    Voice.onSpeechError = (e: any) => {
      console.log('음성 인식 에러:', e);
      
      // 에러 메시지 매핑
      const errorMessages: { [key: string]: string } = {
        '203': '음성이 인식되지 않았습니다. 다시 시도해주세요.',
        '1': '음성 인식 서비스에 일시적인 문제가 있습니다.',
        'default': '음성 인식 중 오류가 발생했습니다. 다시 시도해주세요.'
      };

      // 에러 코드에 따른 메시지 설정
      let errorMessage = errorMessages.default;
      if (e.error?.code) {
        errorMessage = errorMessages[e.error.code] || errorMessages.default;
      }
      
      setError(errorMessage);
      setIsRecording(false);
      setIsListening(false);
    };

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const onSpeechResults = (e: SpeechResultsEvent) => {
    if (e.value) {
      const recognizedText = e.value[0];
      setRecognizedText(recognizedText);
      const score = calculateSimilarity(targetWord, recognizedText);
      setSimilarityScore(score);
    }
  };

  async function startListening() {
    try {
      console.log('음성 인식 시작 시도');
      await Voice.start('ko-KR');
      console.log('음성 인식 시작 성공');
      setIsListening(true);
    } catch (error) {
      console.error('음성 인식 시작 실패:', error);
    }
  }

  async function stopListening() {
    try {
      await Voice.stop();
      setIsListening(false);
    } catch (error) {
      console.error('음성 인식 중지 실패:', error);
    }
  }

  async function startRecording() {
    try {
      console.log('녹음 권한 요청');
      const permission = await Audio.requestPermissionsAsync();
      console.log('녹음 권한 상태:', permission.status);
      
      if (permission.status !== 'granted') {
        console.error('마이크 권한이 거부됨');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('녹음 시작');
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      
      // 녹음 시작과 함께 음성 인식 시작
      await startListening();
    } catch (err) {
      console.error('녹음 시작 실패', err);
    }
  }
  async function stopRecording() {
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      await stopListening();
      setIsRecording(false);
      
      const uri = recording.getURI();
      console.log('녹음 파일 위치:', uri);
      console.log('인식된 텍스트:', recognizedText);
    } catch (err) {
      console.error('녹음 중지 실패', err);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Korean Pronunciation Practice 🎤</Text>
      
      <Text style={styles.targetWord}>목표 단어: {targetWord}</Text>
      
      <TouchableOpacity
        style={[styles.button, isRecording && styles.recordingButton]}
        onPress={isRecording ? stopRecording : startRecording}
      >
        <Text style={styles.buttonText}>
          {isRecording ? '녹음 중지' : '녹음 시작'}
        </Text>
      </TouchableOpacity>

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {recognizedText ? (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>인식된 텍스트:</Text>
          <Text style={styles.resultText}>{recognizedText}</Text>
          
          {similarityScore !== null && (
            <View style={styles.scoreContainer}>
              <Text style={styles.scoreTitle}>발음 정확도:</Text>
              <Text style={[
                styles.scoreText,
                similarityScore >= 90 ? styles.scoreExcellent :
                similarityScore >= 70 ? styles.scoreGood :
                styles.scorePoor
              ]}>
                {similarityScore}점
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  text: {
    fontSize: 24,
    color: '#333',
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 25,
    width: 200,
    alignItems: 'center',
  },
  recordingButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
  },
  targetWord: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#2196F3',
  },
  scoreContainer: {
    marginTop: 15,
    alignItems: 'center',
  },
  scoreTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  scoreText: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  scoreExcellent: {
    color: '#4CAF50',
  },
  scoreGood: {
    color: '#FFC107',
  },
  scorePoor: {
    color: '#F44336',
  },
  resultContainer: {
    marginTop: 30,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    width: '80%',
    alignItems: 'center',
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 16,
    color: '#333',
  },
  errorContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    width: '80%',
    alignItems: 'center',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    textAlign: 'center',
  },
});

export default App;