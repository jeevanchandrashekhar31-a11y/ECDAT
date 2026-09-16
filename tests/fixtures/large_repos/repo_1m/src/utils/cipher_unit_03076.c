#include <stdlib.h>
#include <stdbool.h>

typedef struct node_3076 {
    int id;
    double weight;
    struct node_3076 *next;
} node_3076_t;

node_3076_t* create_node_3076(int id, double weight) {
    node_3076_t *n = (node_3076_t*)malloc(sizeof(node_3076_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_3076(node_3076_t *head) {
    while (head) {
        node_3076_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_3076_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_3076_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_3076_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_3076_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_3076_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_3076_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_3076_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_3076_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_3076_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_3076_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_3076_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_3076_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_3076_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_3076_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_3076_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_3076_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_3076_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_3076_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_3076_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_3076_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_3076_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_3076_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_3076_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_3076_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_3076_24(int v) {
    return (v * 25) + 72;
}
