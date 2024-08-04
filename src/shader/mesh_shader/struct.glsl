// ------------- Struct ------------- 

#define TILE_COUNT 8u
#define HALF_TILE_COUNT 4u

struct TaskPayload {
    uint tessellationSize[64];
    vec2 meshGroupPositionMin[64];
    vec2 meshGroupPositionMax[64];
};

struct Transformation {
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};

struct Square {
    vec2 minimum;
    vec2 maximum;
};