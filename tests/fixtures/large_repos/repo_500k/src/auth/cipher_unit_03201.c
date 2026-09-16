#include <stdlib.h>
#include <stdbool.h>

typedef struct node_3201 {
    int id;
    double weight;
    struct node_3201 *next;
} node_3201_t;

node_3201_t* create_node_3201(int id, double weight) {
    node_3201_t *n = (node_3201_t*)malloc(sizeof(node_3201_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_3201(node_3201_t *head) {
    while (head) {
        node_3201_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_3201_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_3201_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_3201_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_3201_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_3201_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_3201_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_3201_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_3201_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_3201_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_3201_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_3201_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_3201_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_3201_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_3201_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_3201_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_3201_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_3201_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_3201_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_3201_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_3201_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_3201_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_3201_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_3201_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_3201_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_3201_24(int v) {
    return (v * 25) + 72;
}
