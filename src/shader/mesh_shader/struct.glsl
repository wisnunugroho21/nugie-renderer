// ------------- Struct -------------

#define TILE_FACTOR 8u
#define TILE_FACTOR_X 8u
#define TILE_FACTOR_Y 4u
#define TESSELLATION_SIZE 5u

struct TaskPayload {
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